// ส่วนของหน้าต่าง 3D ที่ไม่ต้องวาด Cesium: ค่าตั้งของหน้าต่าง (3D Graphics Window Properties), syncClock, ทะเบียนหน้าต่าง 3D ที่เปิดอยู่,
// คำสั่ง g3d.* / object.zoomTo (W3) และ window.__gnssStudioTest (W19) หน้าต่าง 3D จริงแทนด้วยตัวปลอมที่ทำตาม Scene3DHandle

import { JulianDate } from "cesium";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { syncClock } from "../../src/cesium/clockSync";
import { installTestHooks, testModeRequested } from "../../src/cesium/testHooks";
import { isEnabled, runCommand } from "../../src/commands";
import { useLayout } from "../../src/stores/layout";
import { useSelection } from "../../src/stores/selection";
import { useTime } from "../../src/stores/time";
import { registerGraphics3DCommands } from "../../src/windows/Graphics3D/commands3d";
import { isClick, markersNear, PICK_RADIUS_PX, selectOnClick, selectScenePath } from "../../src/windows/Graphics3D/pick";
import { DEFAULT_PROPS_3D, props3d } from "../../src/windows/Graphics3D/props";
import {
  activeScene, firstScene, markActive, registerScene, resetScenes, sceneLoadedAt, type MouseMode, type Scene3DHandle,
} from "../../src/windows/Graphics3D/registry";
import { registerScene2D, resetScenes2D, type Scene2DHandle } from "../../src/windows/Graphics2D/registry2d";
import { groupKey } from "../../src/windows/ObjectBrowser/tree";
import { useObjectBrowser } from "../../src/windows/ObjectBrowser/state";
import { makeDoc, openScenario, resetAll } from "./helpers/chrome";
import { loadObjects, satPath } from "./helpers/objects";

type Fake = Scene3DHandle & { calls: unknown[][] };

function fakeScene(panelId: string, over: Partial<Scene3DHandle> = {}): Fake {
  const calls: unknown[][] = [];
  let mode: MouseMode = "grab";
  const log = (name: string) => (...args: unknown[]) => void calls.push([name, ...args]);
  return {
    panelId,
    calls,
    homeView: log("homeView"),
    zoomTo: (path: string) => { calls.push(["zoomTo", path]); return true; },
    viewFromTo: (req) => { calls.push(["viewFromTo", req]); return "ok"; },
    sceneFailed: () => false,
    mouseMode: () => mode,
    setMouseMode: (m: MouseMode) => { mode = m; calls.push(["setMouseMode", m]); },
    resize: log("resize"),
    destroy: log("destroy"),
    entityPositionEcef: (name: string, iso?: string) => (name === "G01" ? [1, 2, iso === undefined ? 3 : 4] : null),
    entityColor: (name: string) => (name === "G01" ? "#ffd23f" : null),
    labelShown: (name: string) => (name === "G01" ? true : null),
    frameCount: () => 7,
    loadedAt: () => 1234,
    sensorFootprintPoints: () => null,
    modelCount: () => 3,
    satelliteOrientation: (name: string) => (name === "G01" ? { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] } : null),
    pointShown: (name: string) => (name === "G01" ? false : null),
    pathAt: () => null,
    entityScreenPosition: (name: string) => (name === "G01" ? [320, 240] : null),
    ...over,
  };
}

/** หน้าต่าง 2D ปลอม (เฉพาะส่วนที่ test hook ใช้) */
function fakeScene2D(panelId: string, sensorFootprintPoints: (name: string) => number | null): Scene2DHandle {
  return {
    panelId,
    sceneFailed: () => false,
    resize: () => undefined,
    destroy: () => undefined,
    mouseMode: () => "grab",
    setMouseMode: () => undefined,
    zoomOut: () => undefined,
    viewRectangle: () => null,
    overlayCounts: () => ({}),
    sensorFootprintPoints,
  };
}

beforeEach(() => {
  resetAll();
  resetScenes();
  resetScenes2D();
});
afterEach(() => {
  resetScenes();
  resetScenes2D();
  delete window.__gnssStudioTest;
});

describe("3D Graphics Window Properties values", () => {
  test("missing or broken values fall back to the defaults", () => {
    expect(props3d(undefined)).toEqual(DEFAULT_PROPS_3D);
    expect(props3d({ enableLighting: "yes", ambientLevel: "x", showTime: 1 })).toEqual(DEFAULT_PROPS_3D);
  });

  test("levels are percentages kept within 0 to 100", () => {
    expect(props3d({ ambientLevel: 150, sunLevel: -5, nightLightsLevel: 42.5 })).toMatchObject({ ambientLevel: 100, sunLevel: 0, nightLightsLevel: 42.5 });
  });

  test("stored values are used as they are", () => {
    const p = {
      enableLighting: true, ambientLevel: 10, sunLevel: 80, nightLightsLevel: 0, latLonLines: true, labelDeclutter: true, showTime: false,
      satelliteModels: false, modelPixelSize: 100,
    };
    expect(props3d(p)).toEqual(p);
  });

  test("Satellite Models is on by default at 48 px; Model Pixel Size is a whole number kept within 16 to 256", () => {
    expect(DEFAULT_PROPS_3D).toMatchObject({ satelliteModels: true, modelPixelSize: 48 });
    expect(props3d({})).toMatchObject({ satelliteModels: true, modelPixelSize: 48 }); // workbook รุ่นก่อนมีโมเดล
    expect(props3d({ modelPixelSize: 4 }).modelPixelSize).toBe(16);
    expect(props3d({ modelPixelSize: 1000 }).modelPixelSize).toBe(256);
    expect(props3d({ modelPixelSize: 63.6 }).modelPixelSize).toBe(64);
    expect(props3d({ modelPixelSize: "64", satelliteModels: "no" })).toMatchObject({ satelliteModels: true, modelPixelSize: 48 });
  });
});

test("syncClock sets the viewer time from the app clock and asks for a frame", () => {
  const requestRender = vi.fn();
  const viewer = { clock: { currentTime: new JulianDate() }, scene: { requestRender } };
  syncClock(viewer as never, new Date("2026-11-11T06:30:00Z"));
  expect(JulianDate.toIso8601(viewer.clock.currentTime, 0)).toBe("2026-11-11T06:30:00Z");
  expect(requestRender).toHaveBeenCalledTimes(1);
});

describe("the open 3D windows", () => {
  test("the active one is the active dockview panel, else the last one used, else the first", () => {
    const a = fakeScene("graphics3d");
    const b = fakeScene("graphics3d-2");
    registerScene(a);
    registerScene(b);
    expect(activeScene()).toBe(a);
    markActive("graphics3d-2");
    expect(activeScene()).toBe(b);
    useLayout.setState({ api: { activePanel: { id: "graphics3d" } } as never });
    expect(activeScene()).toBe(a);
  });

  test("the first window is graphics3d when open (the test hooks' viewer), otherwise the oldest", () => {
    const b = fakeScene("graphics3d-2");
    const a = fakeScene("graphics3d");
    registerScene(b);
    registerScene(a);
    expect(firstScene()).toBe(a);
  });

  test("unregistering forgets a window, but only the handle that registered", () => {
    const a = fakeScene("graphics3d");
    const off = registerScene(a);
    const a2 = fakeScene("graphics3d");
    const off2 = registerScene(a2);
    off();
    expect(activeScene()).toBe(a2);
    off2();
    expect(activeScene()).toBeUndefined();
  });

  test("sceneLoadedAt is the load time of the current first 3D window (a window that replaces it starts unloaded)", () => {
    expect(sceneLoadedAt()).toBeNull();
    let at: number | null = 100;
    const off = registerScene(fakeScene("graphics3d", { loadedAt: () => at }));
    expect(sceneLoadedAt()).toBe(100);
    off();
    expect(sceneLoadedAt()).toBeNull();
    at = null;
    const off2 = registerScene(fakeScene("graphics3d", { loadedAt: () => at }));
    expect(sceneLoadedAt()).toBeNull();
    at = 300;
    expect(sceneLoadedAt()).toBe(300);
    off2();
  });
});

describe("commands", () => {
  let dispose: () => void;
  beforeEach(() => {
    dispose = registerGraphics3DCommands();
  });
  afterEach(() => dispose());

  test("are disabled until a 3D window exists", () => {
    for (const id of ["g3d.homeView", "g3d.viewFromTo", "g3d.properties", "g3d.grabGlobe", "g3d.zoomIn", "object.zoomTo"] as const) {
      expect(isEnabled(id), id).toBe(false);
    }
  });

  test("Home View, Grab Globe and Zoom In act on the active 3D window", () => {
    const a = fakeScene("graphics3d");
    const b = fakeScene("graphics3d-2");
    registerScene(a);
    registerScene(b);
    markActive("graphics3d-2");
    runCommand("g3d.homeView");
    runCommand("g3d.zoomIn");
    expect(b.calls).toEqual([["homeView"], ["setMouseMode", "zoomIn"]]);
    runCommand("g3d.grabGlobe");
    expect(b.mouseMode()).toBe("grab");
    expect(a.calls).toEqual([]);
  });

  test("Properties and View From/To open their windows for the active 3D window", () => {
    openScenario();
    const openPanel = vi.fn(() => "x");
    useLayout.setState({ openPanel } as never);
    registerScene(fakeScene("graphics3d-2"));
    runCommand("g3d.properties");
    runCommand("g3d.viewFromTo");
    expect(openPanel.mock.calls).toEqual([["windowProperties3d", { target: "graphics3d-2" }], ["viewFromTo", { target: "graphics3d-2" }]]);
  });

  test("View From/To needs an open scenario (it picks scenario objects)", () => {
    registerScene(fakeScene("graphics3d"));
    expect(isEnabled("g3d.viewFromTo")).toBe(false);
    openScenario();
    expect(isEnabled("g3d.viewFromTo")).toBe(true);
  });

  test("Zoom To is enabled only for a selected Facility or Satellite with a 3D window open", () => {
    const a = fakeScene("graphics3d");
    useSelection.getState().select("*/Satellite/G01");
    expect(isEnabled("object.zoomTo")).toBe(false);
    registerScene(a);
    expect(isEnabled("object.zoomTo")).toBe(true);
    runCommand("object.zoomTo");
    expect(a.calls).toEqual([["zoomTo", "*/Satellite/G01"]]);
    useSelection.getState().select("*/Facility/THBK");
    expect(isEnabled("object.zoomTo")).toBe(true);
    for (const path of ["*/Constellation/GPS", "*", null]) {
      useSelection.getState().select(path);
      expect(isEnabled("object.zoomTo"), String(path)).toBe(false);
    }
  });

  describe("Zoom To on a sensor goes to the satellite it is on", () => {
    const sensor = (name: string, parent: string) => ({ class: "Sensor", name, parent });
    const open = (...objects: object[]) => openScenario(makeDoc({ objects: [{ class: "Satellite", name: "G01", norad: 40101 }, { class: "Satellite", name: "G02", norad: 40102 }, ...objects] as never }));

    test("is enabled and zooms to the parent satellite", () => {
      open(sensor("S1", "*/Satellite/G01"));
      const a = fakeScene("graphics3d");
      registerScene(a);
      useSelection.getState().select("*/Sensor/S1");
      expect(isEnabled("object.zoomTo")).toBe(true);
      runCommand("object.zoomTo");
      expect(a.calls).toEqual([["zoomTo", "*/Satellite/G01"]]);
    });

    test("follows the parent of each sensor", () => {
      open(sensor("S1", "*/Satellite/G01"), sensor("Nav", "*/Satellite/G02"));
      const a = fakeScene("graphics3d");
      registerScene(a);
      useSelection.getState().select("*/Sensor/Nav");
      runCommand("object.zoomTo");
      expect(a.calls).toEqual([["zoomTo", "*/Satellite/G02"]]);
    });

    test("needs a 3D window, like the other objects", () => {
      open(sensor("S1", "*/Satellite/G01"));
      useSelection.getState().select("*/Sensor/S1");
      expect(isEnabled("object.zoomTo")).toBe(false);
    });

    test("a sensor the scenario does not have has no satellite to go to: disabled, and running it does nothing", () => {
      open(sensor("S1", "*/Satellite/G01"));
      const a = fakeScene("graphics3d");
      registerScene(a);
      useSelection.getState().select("*/Sensor/Gone");
      expect(isEnabled("object.zoomTo")).toBe(false);
      runCommand("object.zoomTo");
      expect(a.calls).toEqual([]);
    });

    test("no scenario open: disabled", () => {
      registerScene(fakeScene("graphics3d"));
      useSelection.getState().select("*/Sensor/S1");
      expect(isEnabled("object.zoomTo")).toBe(false);
    });
  });
});

describe("picking in the 3D window", () => {
  const G01 = satPath("G01");
  const at = (x: number, y: number) => ({ x, y });
  const pathAt = (path: string | null) => vi.fn((_x: number, _y: number): string | null => path);

  test("a drag is not a click", () => {
    expect(isClick(at(10, 10), at(15, 10))).toBe(false); // เลื่อน 5 px
    expect(isClick(at(10, 10), at(10, 5))).toBe(false);
    expect(isClick(at(10, 10), at(13, 13))).toBe(false); // ระยะ 4.2 px: วัดระยะจริง ไม่ใช่แยกแกน
    expect(isClick(at(10, 10), at(10, 10))).toBe(true);
    expect(isClick(at(10, 10), at(14, 10))).toBe(true); // ไม่เกิน 4 px ยังเป็นคลิก (spec S4)
    expect(isClick(at(10, 10), at(20, 10), 12)).toBe(true); // ค่าเผื่อกำหนดเองได้
  });

  test("the markers under the mouse are those within 8 px, nearest first; ones that are not in the picture are skipped", () => {
    expect(PICK_RADIUS_PX).toBe(8);
    const markers = [
      { id: "sat/far", at: at(100, 100) },
      { id: "sat/edge", at: at(58, 50) }, // 8 px: ยังชี้อยู่
      { id: "sat/near", at: at(52, 51) },
      { id: "sat/justOut", at: at(50, 58.1) },
      { id: "sat/hidden", at: null },
      { id: "fac/under", at: at(50, 50) },
    ];
    expect(markersNear(markers, at(50, 50))).toEqual(["fac/under", "sat/near", "sat/edge"]);
    expect(markersNear(markers, at(50, 50), 1)).toEqual(["fac/under"]);
    expect(markersNear(markers, at(300, 300))).toEqual([]);
    expect(markersNear([], at(0, 0))).toEqual([]);
  });

  test("a drag that ends over a satellite does not pick it (rotating the globe still works)", () => {
    const pick = pathAt(G01);
    selectOnClick(at(10, 10), at(60, 12), pick);
    expect(pick).not.toHaveBeenCalled();
    expect(useSelection.getState().activePath).toBeNull();
  });

  test("click selects the picked satellite", () => {
    loadObjects();
    const pick = pathAt(G01);
    selectOnClick(at(100, 80), at(102, 81), pick);
    expect(pick).toHaveBeenCalledWith(102, 81); // ที่ที่ปล่อยเมาส์
    expect(useSelection.getState().activePath).toBe(G01);
  });

  test("click on empty space keeps the selection", () => {
    loadObjects();
    useSelection.getState().select("*/Facility/THBK");
    const pick = pathAt(null);
    selectOnClick(at(100, 80), at(100, 80), pick);
    expect(pick).toHaveBeenCalledTimes(1);
    expect(useSelection.getState().activePath).toBe("*/Facility/THBK");
  });

  test("selecting from the picture is like selecting from elsewhere: the folder that hides the row opens, a selected folder is dropped, the row is scrolled to", () => {
    loadObjects();
    useObjectBrowser.setState({ collapsed: new Set([groupKey("GPS sats")]), groupSelected: groupKey("Mine") });
    selectScenePath(G01);
    expect(useSelection.getState().activePath).toBe(G01);
    expect(useObjectBrowser.getState().groupSelected).toBeNull();
    expect(useObjectBrowser.getState().collapsed.has(groupKey("GPS sats"))).toBe(false);
    expect(useObjectBrowser.getState().scrollTarget).toBe(G01);
    // เลือกดาวเดิมซ้ำหลังพับโฟลเดอร์: เปิดให้เห็นอีกครั้ง
    useObjectBrowser.setState({ collapsed: new Set([groupKey("GPS sats")]) });
    selectScenePath(G01);
    expect(useObjectBrowser.getState().collapsed.has(groupKey("GPS sats"))).toBe(false);
  });
});

describe("window.__gnssStudioTest (W19)", () => {
  test("is wanted only when the URL has ?test", () => {
    expect(testModeRequested("?sc=E2E&test")).toBe(true);
    expect(testModeRequested("?test=1")).toBe(true);
    expect(testModeRequested("?sc=E2E")).toBe(false);
    expect(testModeRequested("")).toBe(false);
  });

  test("setTime moves the app clock; the other hooks ask the first 3D window by object name", () => {
    installTestHooks();
    const hooks = window.__gnssStudioTest!;
    hooks.setTime("2026-11-11T06:00:00Z");
    expect(useTime.getState().current.toISOString()).toBe("2026-11-11T06:00:00.000Z");
    expect(() => hooks.setTime("not a time")).toThrow(RangeError);
    expect(hooks.entityPositionEcef("G01")).toBeNull(); // ยังไม่มีหน้าต่าง 3D
    expect(hooks.frameCount()).toBe(0);
    expect(hooks.modelCount()).toBe(0); // ไม่มีหน้าต่าง 3D
    expect(hooks.satelliteOrientation("G01")).toBeNull();
    expect(hooks.pointShown("G01")).toBeNull();
    registerScene(fakeScene("graphics3d"));
    expect(hooks.modelCount()).toBe(3);
    expect(hooks.satelliteOrientation("G01")).toEqual({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] });
    expect(hooks.satelliteOrientation("NOPE")).toBeNull();
    expect(hooks.pointShown("G01")).toBe(false);
    expect(hooks.pointShown("NOPE")).toBeNull();
    expect(hooks.entityPositionEcef("G01")).toEqual([1, 2, 3]);
    expect(hooks.entityPositionEcef("G01", "2026-11-11T06:00:00Z")).toEqual([1, 2, 4]);
    expect(hooks.entityPositionEcef("NOPE")).toBeNull();
    expect(hooks.entityColor("G01")).toBe("#ffd23f");
    expect(hooks.labelShown("G01")).toBe(true);
    expect(hooks.labelShown("NOPE")).toBeNull();
    expect(hooks.frameCount()).toBe(7);
    expect(hooks.sceneLoadedAt()).toBe(1234);
  });

  test("sensorFootprint asks the first 3D or 2D window how many ring points it draws", () => {
    installTestHooks();
    const hooks = window.__gnssStudioTest!;
    expect(hooks.sensorFootprint("Sensor1", "3d")).toBeNull(); // ยังไม่มีหน้าต่าง
    expect(hooks.sensorFootprint("Sensor1", "2d")).toBeNull();
    registerScene(fakeScene("graphics3d-2", { sensorFootprintPoints: () => 1 }));
    registerScene(fakeScene("graphics3d", { sensorFootprintPoints: (name) => (name === "Sensor1" ? 73 : null) }));
    registerScene2D(fakeScene2D("graphics2d-2", () => 2));
    registerScene2D(fakeScene2D("graphics2d", (name) => (name === "Sensor1" ? 37 : null)));
    expect(hooks.sensorFootprint("Sensor1", "3d")).toBe(73);
    expect(hooks.sensorFootprint("Sensor2", "3d")).toBeNull();
    expect(hooks.sensorFootprint("Sensor1", "2d")).toBe(37);
    expect(hooks.sensorFootprint("Sensor2", "2d")).toBeNull();
  });

  test("entityScreenPosition asks the first 3D window where an object is in its picture", () => {
    installTestHooks();
    const hooks = window.__gnssStudioTest!;
    expect(hooks.entityScreenPosition("G01")).toBeNull(); // ยังไม่มีหน้าต่าง 3D
    registerScene(fakeScene("graphics3d-2", { entityScreenPosition: () => [1, 2] }));
    registerScene(fakeScene("graphics3d"));
    expect(hooks.entityScreenPosition("G01")).toEqual([320, 240]);
    expect(hooks.entityScreenPosition("NOPE")).toBeNull(); // ไม่อยู่ในภาพ (ซ่อน อยู่หลังโลก หรือนอกภาพ)
  });

  test("installing twice keeps the first object", () => {
    installTestHooks();
    const first = window.__gnssStudioTest;
    installTestHooks();
    expect(window.__gnssStudioTest).toBe(first);
  });
});
