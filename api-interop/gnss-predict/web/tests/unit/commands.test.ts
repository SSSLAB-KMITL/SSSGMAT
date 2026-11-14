import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  COMMAND_LABELS, commandText, commandTooltip, invalidateCommands, isEnabled, isRegistered, registerCommand, resetCommands, runCommand,
  subscribeCommands, commandsVersion, type CommandId,
} from "../../src/commands";
import { labels, t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { TOOLBAR_NAMES } from "../../src/layout/workbook";
import { useLayout } from "../../src/stores/layout";
import { useMessages } from "../../src/stores/messages";
import { useScenario, type InsertBody } from "../../src/stores/scenario";
import { useSelection } from "../../src/stores/selection";
import { registerScene, resetScenes, type Scene3DHandle } from "../../src/windows/Graphics3D/registry";
import { registerSensorViewCommands } from "../../src/windows/SensorView/commands";
import { sensorViewScenes, type SensorViewHandle } from "../../src/windows/SensorView/registry";
import { resetAll } from "./helpers/chrome";
import { loadSensors, makeScenarioDoc, makeTree, satPath, sensorPath, type SensorsOf } from "./helpers/objects";

beforeEach(resetCommands);
afterEach(resetCommands);

describe("command registry", () => {
  test("a command that was never registered is disabled and does nothing", () => {
    expect(isRegistered("file.save")).toBe(false);
    expect(isEnabled("file.save")).toBe(false);
    expect(() => runCommand("file.save")).not.toThrow();
  });

  test("a registered command runs, and is enabled unless enabled() says otherwise", () => {
    const run = vi.fn();
    registerCommand("file.save", { label: "menu.file.save", run });
    expect(isEnabled("file.save")).toBe(true);
    runCommand("file.save");
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("enabled() false disables the command and runCommand refuses to run it", () => {
    const run = vi.fn();
    let on = false;
    registerCommand("file.save", { label: "menu.file.save", run, enabled: () => on });
    expect(isEnabled("file.save")).toBe(false);
    runCommand("file.save");
    expect(run).not.toHaveBeenCalled();
    on = true;
    expect(isEnabled("file.save")).toBe(true);
    runCommand("file.save");
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("a throwing enabled() counts as disabled", () => {
    registerCommand("file.save", { label: "menu.file.save", run: vi.fn(), enabled: () => { throw new Error("boom"); } });
    expect(isEnabled("file.save")).toBe(false);
  });

  test("registering again replaces the earlier registration", () => {
    const first = vi.fn();
    const second = vi.fn();
    registerCommand("file.save", { label: "menu.file.save", run: first });
    registerCommand("file.save", { label: "menu.file.save", run: second });
    runCommand("file.save");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  test("registerCommand returns a disposer that removes the registration only while it is still the current one", () => {
    const a = vi.fn();
    const b = vi.fn();
    const disposeA = registerCommand("file.save", { label: "menu.file.save", run: a });
    const disposeB = registerCommand("file.save", { label: "menu.file.save", run: b }); // B replaces A
    disposeA(); // A's disposer must leave B in place
    expect(isRegistered("file.save")).toBe(true);
    runCommand("file.save");
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    disposeB();
    expect(isRegistered("file.save")).toBe(false);
    expect(isEnabled("file.save")).toBe(false);
  });

  test("a disposer notifies subscribers when it removes something, and is harmless to call twice", () => {
    const dispose = registerCommand("file.save", { label: "menu.file.save", run: vi.fn() });
    const listener = vi.fn();
    subscribeCommands(listener);
    dispose();
    expect(listener).toHaveBeenCalledTimes(1);
    dispose();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("a command that throws, or rejects, does not break the caller", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    registerCommand("file.save", { label: "menu.file.save", run: () => { throw new Error("sync"); } });
    registerCommand("file.saveAs", { label: "menu.file.saveAs", run: () => Promise.reject(new Error("async")) });
    expect(() => runCommand("file.save")).not.toThrow();
    expect(() => runCommand("file.saveAs")).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  test("it is observable: registering, replacing and invalidating notify subscribers and bump the version", () => {
    const listener = vi.fn();
    const off = subscribeCommands(listener);
    const v0 = commandsVersion();
    registerCommand("file.save", { label: "menu.file.save", run: vi.fn() });
    expect(listener).toHaveBeenCalledTimes(1);
    invalidateCommands();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(commandsVersion()).toBeGreaterThan(v0);
    off();
    registerCommand("file.save", { label: "menu.file.save", run: vi.fn() });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("the tooltip is the registered one, and the pending ones are Thai and only while unregistered", () => {
    expect(commandTooltip("file.save")).toBeUndefined();
    for (const id of ["analysis.reportGraphManager", "analysis.validation", "object.reportGraphManager"] as const) {
      expect(commandTooltip(id), id).toBe(msg("tooltip.subtask4"));
    }
    // Access tool (sub-project 4 Task 11) is built: no "not yet" note, even before windows/AccessTool/commands.ts registers it
    for (const id of ["analysis.access", "object.access"] as const) expect(commandTooltip(id), id).toBeUndefined();
    registerCommand("analysis.reportGraphManager", { label: "menu.analysis.reportGraphManager", run: vi.fn() });
    expect(commandTooltip("analysis.reportGraphManager")).toBeUndefined(); // registered: no more "not yet" note
    registerCommand("file.save", { label: "menu.file.save", run: vi.fn(), enabled: () => false, tooltip: () => "เหตุผล" });
    expect(commandTooltip("file.save")).toBe("เหตุผล");
  });

  test("commandText is the registered text(), else the label of the registration, else the default label", () => {
    expect(commandText("file.save")).toBe(t("menu.file.save"));
    registerCommand("file.recent.1", { label: "menu.file.recent", run: vi.fn(), text: () => "T1" });
    expect(commandText("file.recent.1")).toBe("T1");
  });
});

describe("command ids", () => {
  const ids = Object.keys(COMMAND_LABELS) as CommandId[];

  test("every id of spec §5.1-§5.2 and §7 is there, once", () => {
    const expected = [
      "file.new", "file.open", "file.save", "file.saveAs", "file.close", "file.exit", "file.recent.1", "file.recent.2", "file.recent.3", "file.recent.4",
      "edit.cut", "edit.copy", "edit.paste", "edit.delete", "edit.find",
      "view.objectBrowser", "view.timelineView", "view.messageViewer", "view.new3d", "view.new2d", "view.globeManager",
      ...TOOLBAR_NAMES.map((n) => `view.toolbar.${n}`), "view.fullScreen",
      "insert.new", "insert.facility", "insert.satellite", "insert.sensor", "insert.constellation",
      "analysis.access", "analysis.reportGraphManager", "analysis.validation",
      "object.properties", "object.sensorView", "object.access", "object.reportGraphManager", "object.zoomTo", "object.rename", "object.delete",
      "utilities.fetchOrbitData", "utilities.dailyForecastSettings",
      "window.windows", "window.cascade", "window.tileHorizontally", "window.tileVertically",
      "help.welcome", "help.stkReference", "help.about",
      "anim.reset", "anim.stepBackward", "anim.reverse", "anim.pause", "anim.start", "anim.stepForward", "anim.decreaseStep", "anim.increaseStep",
      "anim.normal", "anim.realtime", "anim.xrealtime",
      "g3d.homeView", "g3d.viewFromTo", "g3d.properties", "g3d.grabGlobe", "g3d.zoomIn",
      "g2d.properties", "g2d.zoomIn", "g2d.zoomOut",
      "ob.newGroup", "ob.expandAll", "ob.collapseAll", "ob.colorSelectors", "ob.onOffToggles", "ob.showFlagged",
    ];
    expect([...ids].sort()).toEqual([...expected].sort());
  });

  test("every id has a label key that exists in labels.ts", () => {
    for (const id of ids) expect(labels[COMMAND_LABELS[id]], id).toBeDefined();
  });
});

describe("object.sensorView (sensor spec §5.1)", () => {
  /** ตำแหน่ง Earth-fixed (m) ของดาว GPS (รัศมีวงโคจร 26,560 km): ρ = asin(6371.0088 / 26560) = 13.88° → ρ + 0.5 = 14.4 */
  const GPS_ECEF: [number, number, number] = [26_560_000, 0, 0];
  const openPanel = vi.fn((_kind: string, _params?: Record<string, unknown>) => "sensorView");
  let dispose: () => void;

  /** หน้าต่าง 3D ปลอม (เฉพาะส่วนที่คำสั่งนี้ใช้: ตำแหน่งของดาวสำหรับ Cone Half Angle ตั้งต้น) */
  const scene3d = (positions: Record<string, [number, number, number]>): Scene3DHandle =>
    ({ panelId: "graphics3d", entityPositionEcef: (name: string) => positions[name] ?? null }) as unknown as Scene3DHandle;
  /** Sensor View ปลอมที่เปิดอยู่ (ของ sensor บนดาวอื่น) ภาพของมันมีตำแหน่งของดาวทุกดวงแบบหน้าต่าง 3D */
  const sensorScene = (panelId: string, positions: Record<string, [number, number, number]>): SensorViewHandle =>
    ({ panelId, entityPositionEcef: (name: string) => positions[name] ?? null }) as unknown as SensorViewHandle;

  /** พื้นที่ทำงานปลอมที่มี Sensor View ของ sensor เหล่านี้เปิดอยู่ */
  const workspaceWith = (open: string[]) => {
    const panels = open.map((path, i) => ({ id: `sensorView-${i}`, api: { component: "sensorView" }, params: { path, up: "north" } }));
    useLayout.setState({ api: { panels } as never, openPanel } as never);
  };

  /** insert ปลอม: ทำแบบ store จริง (โหลด doc และต้นไม้ใหม่ก่อนคืน path ที่สร้าง) */
  const insertSpy = (sensors: SensorsOf) =>
    vi.fn(async (body: InsertBody) => {
      const parent = String(body.parent).split("/")[2];
      const next = { ...sensors, [parent]: [...(sensors[parent] ?? []), String(body.name)] };
      useScenario.setState({ doc: makeScenarioDoc({}, next), tree: makeTree({ sensors: next }) });
      return [sensorPath(String(body.name))];
    });

  beforeEach(() => {
    resetAll();
    resetScenes();
    sensorViewScenes.reset();
    openPanel.mockClear();
    workspaceWith([]);
    dispose = registerSensorViewCommands();
  });
  afterEach(() => {
    dispose();
    resetScenes();
    sensorViewScenes.reset();
  });

  const info = () => useMessages.getState().items.filter((m) => m.level === "info").map((m) => m.text);

  test("Sensor View on a satellite without sensors creates Sensor1 with the default cone half angle", async () => {
    loadSensors({});
    registerScene(scene3d({ G01: GPS_ECEF }));
    const insert = insertSpy({});
    useScenario.setState({ insert } as never);
    useSelection.getState().select(satPath("G01"));
    expect(isEnabled("object.sensorView")).toBe(true);
    runCommand("object.sensorView");
    await vi.waitFor(() => expect(openPanel).toHaveBeenCalled());
    expect(insert.mock.calls).toEqual([[{
      class: "Sensor", method: "Define Properties", name: "Sensor1", parent: satPath("G01"), definition: { type: "Simple Conic", cone_half_angle: 14.4 },
    }]]);
    expect(useSelection.getState().activePath).toBe(sensorPath("Sensor1")); // เลือก sensor ใหม่
    expect(info()).toEqual([msg("sensorView.created", { sensor: "Sensor1", satellite: "G01", angle: "14.4" })]);
    expect(openPanel.mock.calls).toEqual([["sensorView", { path: sensorPath("Sensor1"), up: "north", display: "camera", zoom: 1 }]]);
  });

  test("without a 3D position the new sensor gets 45", async () => {
    loadSensors({});
    registerScene(scene3d({})); // หน้าต่าง 3D ยังไม่มีตำแหน่งของ G01 (ไม่มีผล)
    const insert = insertSpy({});
    useScenario.setState({ insert } as never);
    useSelection.getState().select(satPath("G01"));
    runCommand("object.sensorView");
    await vi.waitFor(() => expect(openPanel).toHaveBeenCalled());
    expect(insert.mock.calls[0][0]).toMatchObject({ definition: { type: "Simple Conic", cone_half_angle: 45 } });
    expect(info()).toEqual([msg("sensorView.created", { sensor: "Sensor1", satellite: "G01", angle: "45.0" })]);
  });

  test("without a 3D window the position comes from an open Sensor View; with neither the new sensor gets 45", async () => {
    // ไม่มีหน้าต่าง 3D แต่มี Sensor View (ของ sensor บน G02) เปิดอยู่ซึ่งภาพของมันมี G01: ρ + 0.5
    loadSensors({ G02: ["Cam"] });
    workspaceWith([sensorPath("Cam")]);
    sensorViewScenes.register(sensorScene("sensorView-0", { G01: GPS_ECEF }));
    const insert = insertSpy({ G02: ["Cam"] });
    useScenario.setState({ insert } as never);
    useSelection.getState().select(satPath("G01"));
    runCommand("object.sensorView");
    await vi.waitFor(() => expect(openPanel).toHaveBeenCalled());
    expect(insert.mock.calls[0][0]).toMatchObject({ name: "Sensor1", definition: { cone_half_angle: 14.4 } });

    // หน้าต่าง 3D ที่ไม่มีตำแหน่งของ G01 ไม่บังตำแหน่งจาก Sensor View
    openPanel.mockClear();
    insert.mockClear();
    loadSensors({ G02: ["Cam"] });
    registerScene(scene3d({}));
    useSelection.getState().select(satPath("G01"));
    runCommand("object.sensorView");
    await vi.waitFor(() => expect(openPanel).toHaveBeenCalled());
    expect(insert.mock.calls[0][0]).toMatchObject({ definition: { cone_half_angle: 14.4 } });

    // ไม่มีทั้งหน้าต่าง 3D และ Sensor View = 45
    openPanel.mockClear();
    insert.mockClear();
    resetScenes();
    sensorViewScenes.reset();
    loadSensors({ G02: ["Cam"] });
    useSelection.getState().select(satPath("G01"));
    runCommand("object.sensorView");
    await vi.waitFor(() => expect(openPanel).toHaveBeenCalled());
    expect(insert.mock.calls[0][0]).toMatchObject({ definition: { cone_half_angle: 45 } });
  });

  test("the new sensor takes the first free Sensor<n> name of the whole scenario", async () => {
    loadSensors({ G02: ["Sensor1"] });
    const insert = insertSpy({ G02: ["Sensor1"] });
    useScenario.setState({ insert } as never);
    useSelection.getState().select(satPath("G01"));
    runCommand("object.sensorView");
    await vi.waitFor(() => expect(openPanel).toHaveBeenCalled());
    expect(insert.mock.calls[0][0]).toMatchObject({ name: "Sensor2", parent: satPath("G01") });
    expect(openPanel.mock.calls).toEqual([["sensorView", { path: sensorPath("Sensor2"), up: "north", display: "camera", zoom: 1 }]]);
  });

  test("Sensor View on a satellite with sensors opens the first one", async () => {
    loadSensors({ G01: ["Cam", "Nav"] });
    const insert = insertSpy({});
    useScenario.setState({ insert } as never);
    useSelection.getState().select(satPath("G01"));
    runCommand("object.sensorView");
    await vi.waitFor(() => expect(openPanel).toHaveBeenCalled());
    expect(openPanel.mock.calls).toEqual([["sensorView", { path: sensorPath("Cam"), up: "north", display: "camera", zoom: 1 }]]);
    expect(insert).not.toHaveBeenCalled();
  });

  test("Sensor View on a sensor opens its own window", async () => {
    loadSensors({ G01: ["Cam", "Nav"] });
    useSelection.getState().select(sensorPath("Nav"));
    expect(isEnabled("object.sensorView")).toBe(true);
    runCommand("object.sensorView");
    await vi.waitFor(() => expect(openPanel).toHaveBeenCalled());
    expect(openPanel.mock.calls).toEqual([["sensorView", { path: sensorPath("Nav"), up: "north", display: "camera", zoom: 1 }]]);
  });

  test("an open window is brought back without resetting its Up", async () => {
    loadSensors({ G01: ["Cam"] });
    workspaceWith([sensorPath("Cam")]);
    useSelection.getState().select(sensorPath("Cam"));
    runCommand("object.sensorView");
    await vi.waitFor(() => expect(openPanel).toHaveBeenCalled());
    expect(openPanel.mock.calls).toEqual([["sensorView", { path: sensorPath("Cam") }]]);
  });

  test("with four windows open, a satellite without sensors gets no new sensor and the limit message", async () => {
    loadSensors({ G02: ["S2"], G03: ["S3"], G04: ["S4"], G05: ["S5"] });
    workspaceWith(["S2", "S3", "S4", "S5"].map(sensorPath));
    const insert = insertSpy({});
    useScenario.setState({ insert } as never);
    useSelection.getState().select(satPath("G01"));
    runCommand("object.sensorView");
    await vi.waitFor(() => expect(useMessages.getState().items).toHaveLength(1));
    expect(insert).not.toHaveBeenCalled();
    expect(openPanel).not.toHaveBeenCalled();
    expect(useMessages.getState().items.map((m) => m.text)).toEqual([msg("sensorView.limit")]);
  });

  test("a failed insert is reported and opens nothing", async () => {
    loadSensors({});
    const insert = vi.fn(async () => {
      throw new Error("server down");
    });
    useScenario.setState({ insert } as never);
    useSelection.getState().select(satPath("G01"));
    runCommand("object.sensorView");
    await vi.waitFor(() => expect(useMessages.getState().items.some((m) => m.level === "error")).toBe(true));
    expect(openPanel).not.toHaveBeenCalled();
    expect(info()).toEqual([]);
  });

  test("disabled for Facility and Constellation", () => {
    loadSensors({ G01: ["Cam"] });
    for (const path of ["*/Facility/THBK", "*/Constellation/GPS", "*", "*/Group/Mine", null]) {
      useSelection.getState().select(path);
      expect(isEnabled("object.sensorView"), String(path)).toBe(false);
    }
    for (const path of [satPath("G01"), satPath("G02"), sensorPath("Cam")]) {
      useSelection.getState().select(path);
      expect(isEnabled("object.sensorView"), path).toBe(true);
    }
  });

  test("disabled for an object the scenario does not have, without a scenario, and before the workspace is there", () => {
    loadSensors({ G01: ["Cam"] });
    useSelection.getState().select(sensorPath("Gone"));
    expect(isEnabled("object.sensorView")).toBe(false);
    useSelection.getState().select(satPath("G99"));
    expect(isEnabled("object.sensorView")).toBe(false);
    useSelection.getState().select(sensorPath("Cam"));
    useLayout.setState({ api: null } as never);
    expect(isEnabled("object.sensorView")).toBe(false);
    workspaceWith([]);
    expect(isEnabled("object.sensorView")).toBe(true);
    useScenario.setState({ name: null, doc: null, tree: null });
    expect(isEnabled("object.sensorView")).toBe(false);
  });

  test("the menus are redrawn when what it depends on changes", () => {
    loadSensors({ G01: ["Cam"] });
    const listener = vi.fn();
    const off = subscribeCommands(listener);
    useSelection.getState().select(sensorPath("Cam"));
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    useScenario.setState({ doc: makeScenarioDoc({}, {}) });
    expect(listener).toHaveBeenCalled();
    off();
  });
});
