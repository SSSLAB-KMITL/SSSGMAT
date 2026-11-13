// หน้าต่าง Sensor View (sensor spec §5.4) ส่วน React, การตามต้นไม้ของ scenario (track.ts) และ test hook โดยไม่วาด Cesium:
// การสร้าง viewer (scene3d.mountSensorView) ถูกแทนด้วยตัวปลอมที่ทำตาม SensorViewHandle และ jsdom ได้ WebGLRenderingContext ปลอม
// หน้าต่างเปิดใน Workspace จริง (dockview) เพราะชื่อหน้าต่าง params และการปิดเป็นเรื่องของ dockview

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import userEvent from "@testing-library/user-event";
import type { DockviewApi, IDockviewPanel } from "dockview-react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installTestHooks } from "../../src/cesium/testHooks";
import { runCommand } from "../../src/commands";
import { t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { useLayout } from "../../src/stores/layout";
import { useMessages } from "../../src/stores/messages";
import { useScenario, type ObjectTree, type ScenarioDoc } from "../../src/stores/scenario";
import { useSelection } from "../../src/stores/selection";
import { useTime } from "../../src/stores/time";
import { activeScene, firstScene } from "../../src/windows/Graphics3D/registry";
import { mountSensorView } from "../../src/windows/Graphics3D/scene3d";
import { registerObjectBrowserPanel } from "../../src/windows/ObjectBrowser/ObjectBrowser";
import { registerObjectBrowserCommands } from "../../src/windows/ObjectBrowser/objectCommands";
import { openSensorView } from "../../src/windows/SensorView/commands";
import {
  sensorViewScenes, type SensorCamera, type SensorHud, type SensorViewHandle, type SensorViewUp,
} from "../../src/windows/SensorView/registry";
import { coneCircleRadius, registerSensorViewPanel } from "../../src/windows/SensorView/SensorView";
import { sensorViewRenamed, startSensorViewTracking } from "../../src/windows/SensorView/track";
import { Workspace } from "../../src/Workspace";
import { resetWithCoreCommands } from "./helpers/chrome";
import { loadSensors, makeScenarioDoc, makeTree, sensorPath, type SensorsOf } from "./helpers/objects";

vi.mock("../../src/windows/Graphics3D/scene3d", () => ({ mountScene3D: vi.fn(), mountSensorView: vi.fn() }));

type Fake = SensorViewHandle & { calls: unknown[][]; hud: SensorHud | null; camera: SensorCamera | null };

/** Sensor View ปลอม: จำคำสั่งที่ได้รับ ข้อความบนภาพและกล้องตั้งจาก test */
function fakeView(panelId: string): Fake {
  const calls: unknown[][] = [];
  const fake: Fake = {
    panelId,
    calls,
    hud: null,
    camera: null,
    viewFromSensor: (path: string, up: SensorViewUp) => {
      calls.push(["viewFromSensor", path, up]);
      return "ok";
    },
    sensorHud: () => fake.hud,
    sensorCamera: () => fake.camera,
    entityPositionEcef: () => null,
    sceneFailed: () => false,
    resize: () => void calls.push(["resize"]),
    destroy: () => void calls.push(["destroy"]),
  };
  return fake;
}

const HUD: SensorHud = { sensor: "Sensor1", satellite: "G01", lat: 13.456, lon: -100.004, altKm: 20180.6, coneHalfAngle: 14.38 };

/** handle ที่หน้าต่างแต่ละบานได้ ตาม panelId; nextHud = ข้อความบนภาพของบานที่จะเปิดถัดไป */
let fakes: Map<string, Fake>;
let nextHud: SensorHud | null;
let stopTracking: () => void;
let disposeCore: () => void;

beforeEach(() => {
  disposeCore = resetWithCoreCommands();
  sensorViewScenes.reset();
  registerSensorViewPanel();
  stopTracking = startSensorViewTracking();
  fakes = new Map();
  nextHud = HUD;
  vi.stubGlobal("WebGLRenderingContext", function WebGLRenderingContext() {});
  vi.mocked(mountSensorView).mockReset();
  vi.mocked(mountSensorView).mockImplementation((panelId) => {
    const fake = fakeView(panelId);
    fake.hud = nextHud;
    fakes.set(panelId, fake);
    return fake;
  });
});
afterEach(() => {
  cleanup();
  stopTracking();
  disposeCore();
  sensorViewScenes.reset();
  vi.unstubAllGlobals();
  delete window.__gnssStudioTest;
});

const apiOf = (): DockviewApi => {
  const api = useLayout.getState().api;
  if (api === null) throw new Error("the workspace is not mounted");
  return api;
};
const views = (): IDockviewPanel[] => apiOf().panels.filter((p) => p.api.component === "sensorView");
const titles = () => views().map((p) => p.title);
const title = (sensor: string, satellite: string) => t("window.sensorView", { sensor, satellite });
const messages = (code: string) => useMessages.getState().items.filter((m) => m.code === code);

async function mount(sensors: SensorsOf) {
  loadSensors(sensors);
  useTime.getState().init(useScenario.getState().doc!);
  render(<Workspace />);
  await waitFor(() => expect(useLayout.getState().api).not.toBeNull());
}

/** เปิด Sensor View ของ sensor ชื่อ name แล้วรอให้ภาพ (ตัวปลอม) พร้อม */
async function open(name: string): Promise<Fake> {
  let id: string | null = null;
  act(() => {
    id = openSensorView(sensorPath(name));
  });
  expect(id).not.toBeNull();
  await waitFor(() => expect(fakes.get(id!)).toBeDefined());
  await waitFor(() => expect(sensorViewScenes.get(id!)).toBe(fakes.get(id!)));
  return fakes.get(id!)!;
}

/** doc และต้นไม้ใหม่จาก server (แบบที่ store ใส่หลังโหลดใหม่: ทั้งสองพร้อมกัน) */
function serverSends(doc: ScenarioDoc, tree: ObjectTree): void {
  act(() => useScenario.setState({ doc, tree }));
}

/** doc ที่ object ชื่อ oldName เปลี่ยนชื่อเป็น newName ณ ตำแหน่งเดิม และทุกที่ที่อ้าง path เดิมเปลี่ยนตาม (แบบ objects.rename ของ server) */
function renamedDoc(doc: ScenarioDoc, cls: string, oldName: string, newName: string): ScenarioDoc {
  const before = `*/${cls}/${oldName}`;
  const after = `*/${cls}/${newName}`;
  const next = structuredClone(doc);
  for (const o of next.objects as { class: string; name: string; parent?: string; assigned_objects?: string[] }[]) {
    if (o.class === cls && o.name === oldName) o.name = newName;
    if (o.parent === before) o.parent = after;
    if (o.assigned_objects) o.assigned_objects = o.assigned_objects.map((p) => (p === before ? after : p));
  }
  for (const g of next.groups ?? []) g.members = (g.members ?? []).map((p) => (p === before ? after : p));
  return next;
}

describe("the window", () => {
  test("opens one window per sensor", async () => {
    await mount({ G01: ["Sensor1"], G02: ["Sensor2"] });
    const first = await open("Sensor1");
    expect(titles()).toEqual([title("Sensor1", "G01")]);
    expect(views()[0].api.location.type).toBe("grid"); // Integrated แบบหน้าต่าง 3D
    expect(first.calls).toContainEqual(["viewFromSensor", sensorPath("Sensor1"), "north"]);
    act(() => void openSensorView(sensorPath("Sensor1"))); // เปิดซ้ำ = บานเดิม
    expect(titles()).toEqual([title("Sensor1", "G01")]);
    await open("Sensor2");
    expect(titles()).toEqual([title("Sensor1", "G01"), title("Sensor2", "G02")]);
    expect(views().map((p) => p.params)).toEqual([{ path: sensorPath("Sensor1"), up: "north" }, { path: sensorPath("Sensor2"), up: "north" }]);
  });

  test("its scenes live in their own registry, not with the 3D windows (P3)", async () => {
    await mount({ G01: ["Sensor1"] });
    await open("Sensor1");
    expect(firstScene()).toBeUndefined();
    expect(activeScene()).toBeUndefined();
  });

  test("Up toggle stores north or velocity in the panel params", async () => {
    const user = userEvent.setup();
    await mount({ G01: ["Sensor1"] });
    const fake = await open("Sensor1");
    const bar = screen.getByRole("group", { name: t("sensorView.up") });
    const north = within(bar).getByRole("button", { name: t("sensorView.up.north") });
    const velocity = within(bar).getByRole("button", { name: t("sensorView.up.velocity") });
    expect(north.getAttribute("aria-pressed")).toBe("true");
    expect(velocity.getAttribute("aria-pressed")).toBe("false");
    await user.click(velocity);
    expect(views()[0].params).toEqual({ path: sensorPath("Sensor1"), up: "velocity" });
    await waitFor(() => expect(fake.calls.at(-1)).toEqual(["viewFromSensor", sensorPath("Sensor1"), "velocity"]));
    expect(within(bar).getByRole("button", { name: t("sensorView.up.velocity") }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(bar).getByRole("button", { name: t("sensorView.up.north") }));
    expect(views()[0].params).toEqual({ path: sensorPath("Sensor1"), up: "north" });
    await waitFor(() => expect(fake.calls.at(-1)).toEqual(["viewFromSensor", sensorPath("Sensor1"), "north"]));
    // เปิดซ้ำจากเมนูไม่ล้างค่า Up ที่เลือกไว้
    await user.click(within(bar).getByRole("button", { name: t("sensorView.up.velocity") }));
    act(() => void openSensorView(sensorPath("Sensor1")));
    expect(views()[0].params).toEqual({ path: sensorPath("Sensor1"), up: "velocity" });
  });

  test("HUD shows the sub-point, altitude and cone half angle", async () => {
    await mount({ G01: ["Sensor1"] });
    await open("Sensor1");
    const hud = await screen.findByTestId("sensor-view-hud");
    const lines = within(hud).getAllByText(/.+/).map((el) => el.textContent);
    expect(lines).toContain(title("Sensor1", "G01"));
    expect(lines).toContain(msg("sensorView.hudSubPoint", { lat: "13.46", lon: "-100.00" }));
    expect(lines).toContain(msg("sensorView.hudAltitude", { alt: "20181" }));
    expect(lines).toContain(msg("sensorView.hudCone", { angle: "14.4" }));
    expect(lines).toContain("12 Nov 2026 00:00:00.000 UTCG"); // เวลารูปแบบเดียวกับแถบ Animation
    // วงขอบกรวย: รัศมีเทียบครึ่งด้านสั้นของภาพ
    const circle = document.querySelector(".sensor-view-cone circle");
    expect(Number(circle?.getAttribute("r"))).toBeCloseTo(coneCircleRadius(14.38)!, 9);
    expect(screen.queryByText(msg("sensorView.noPosition", { satellite: "G01" }))).toBeNull();
  });

  test("the HUD is read again when the time moves and when the scene says it changed", async () => {
    await mount({ G01: ["Sensor1"] });
    const fake = await open("Sensor1");
    await screen.findByText(msg("sensorView.hudAltitude", { alt: "20181" }));
    fake.hud = { ...HUD, altKm: 20190.2 };
    act(() => useTime.getState().setCurrent(new Date("2026-11-12T01:00:00Z")));
    expect(await screen.findByText(msg("sensorView.hudAltitude", { alt: "20190" }))).toBeDefined();
    fake.hud = null;
    act(() => sensorViewScenes.notify());
    expect(await screen.findByText(msg("sensorView.noPosition", { satellite: "G01" }))).toBeDefined();
  });

  test("shows the no-position message", async () => {
    nextHud = null;
    await mount({ G01: ["Sensor1"] });
    await open("Sensor1");
    const note = await screen.findByText(msg("sensorView.noPosition", { satellite: "G01" }));
    expect(note.getAttribute("role")).toBe("status"); // ไม่ใช่ error
    expect(screen.queryByTestId("sensor-view-hud")).toBeNull();
    expect(document.querySelector('.sensor-view [role="alert"]')).toBeNull(); // ไม่ใช่ข้อความ error ของภาพ
  });

  test("fifth window is refused with a message", async () => {
    await mount({ G01: ["Sensor1"], G02: ["Sensor2"], G03: ["Sensor3"], G04: ["Sensor4"], G05: ["Sensor5"] });
    for (const name of ["Sensor1", "Sensor2", "Sensor3", "Sensor4"]) await open(name);
    expect(views()).toHaveLength(4);
    let id: string | null = "x";
    act(() => {
      id = openSensorView(sensorPath("Sensor5"));
    });
    expect(id).toBeNull();
    expect(views()).toHaveLength(4);
    expect(messages("SENSOR_VIEW_LIMIT").map((m) => [m.level, m.text])).toEqual([["warning", msg("sensorView.limit")]]);
    // บานที่เปิดอยู่แล้วยังเรียกขึ้นมาได้
    act(() => {
      id = openSensorView(sensorPath("Sensor2"));
    });
    expect(id).not.toBeNull();
    expect(messages("SENSOR_VIEW_LIMIT")).toHaveLength(1);
  });

  test("the sensorViewCamera test hook asks the Sensor View of that sensor", async () => {
    installTestHooks();
    const hooks = window.__gnssStudioTest!;
    await mount({ G01: ["Sensor1"], G02: ["Sensor2"] });
    expect(hooks.sensorViewCamera("Sensor1")).toBeNull(); // ยังไม่เปิด
    const fake = await open("Sensor1");
    await open("Sensor2");
    expect(hooks.sensorViewCamera("Sensor1")).toBeNull(); // ยังไม่มีตำแหน่ง
    fake.camera = { position: [1, 2, 3], direction: [0, 0, -1], up: [0, 1, 0], fovDeg: 31.5 };
    expect(hooks.sensorViewCamera("Sensor1")).toEqual(fake.camera);
    expect(hooks.sensorViewCamera("Nope")).toBeNull();
  });
});

describe("following the scenario (track.ts)", () => {
  test("sensor view closes when its sensor disappears", async () => {
    await mount({ G01: ["Sensor1"], G02: ["Sensor2"] });
    await open("Sensor1");
    await open("Sensor2");
    // Delete Sensor1
    serverSends(makeScenarioDoc({}, { G02: ["Sensor2"] }), makeTree({ sensors: { G02: ["Sensor2"] } }));
    expect(titles()).toEqual([title("Sensor2", "G02")]);
    expect(messages("SENSOR_VIEW_CLOSED").map((m) => [m.level, m.text])).toEqual([["info", msg("sensorView.closedMissing", { sensor: "Sensor1" })]]);
    // Delete G02: server ลบ sensor ของดาวนั้นด้วย
    const doc = makeScenarioDoc({}, {});
    doc.objects = doc.objects.filter((o) => o.name !== "G02");
    serverSends(doc, makeTree());
    expect(views()).toEqual([]);
    expect(messages("SENSOR_VIEW_CLOSED").map((m) => m.text)).toEqual([
      msg("sensorView.closedMissing", { sensor: "Sensor1" }), msg("sensorView.closedMissing", { sensor: "Sensor2" }),
    ]);
  });

  test("sensor view title follows a satellite rename", async () => {
    await mount({ G01: ["Sensor1"] });
    await open("Sensor1");
    const { doc } = useScenario.getState();
    serverSends(renamedDoc(doc!, "Satellite", "G01", "NAV1"), makeTree({ sensors: { G01: ["Sensor1"] } }));
    expect(titles()).toEqual([title("Sensor1", "NAV1")]);
    expect(messages("SENSOR_VIEW_CLOSED")).toEqual([]);
  });

  test("renaming the sensor keeps the window", async () => {
    const user = userEvent.setup();
    registerObjectBrowserPanel();
    const disposeOb = registerObjectBrowserCommands();
    try {
      await mount({ G01: ["Sensor1"] });
      const fake = await open("Sensor1");
      // store จริงโหลด doc และต้นไม้ใหม่เสร็จก่อน rename() คืนค่า แล้ว RenameDialog จึงเรียก onRenamed
      const rename = vi.fn(async (cls: string, name: string, newName: string) => {
        serverSends(renamedDoc(useScenario.getState().doc!, cls, name, newName), makeTree({ sensors: { G01: [newName] } }));
        return { stale: false };
      });
      useScenario.setState({ rename } as never);
      act(() => useSelection.getState().select(sensorPath("Sensor1")));
      act(() => runCommand("object.rename"));
      const dialog = await screen.findByRole("dialog", { name: t("menu.object.rename") });
      const field = within(dialog).getByRole("textbox", { name: t("field.name") });
      await user.clear(field);
      await user.type(field, "Cam{Enter}");
      await waitFor(() => expect(rename).toHaveBeenCalledWith("Sensor", "Sensor1", "Cam"));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(views().map((p) => p.params)).toEqual([{ path: sensorPath("Cam"), up: "north" }]);
      expect(titles()).toEqual([title("Cam", "G01")]);
      await waitFor(() => expect(fake.calls.at(-1)).toEqual(["viewFromSensor", sensorPath("Cam"), "north"]));
      expect(messages("SENSOR_VIEW_CLOSED")).toEqual([]);
    } finally {
      disposeOb();
    }
  });

  test("a rename that reaches the window before the new doc keeps it too", async () => {
    await mount({ G01: ["Sensor1"] });
    await open("Sensor1");
    const before = useScenario.getState().doc!;
    act(() => sensorViewRenamed(sensorPath("Sensor1"), sensorPath("Cam")));
    expect(views().map((p) => p.params?.path)).toEqual([sensorPath("Cam")]);
    serverSends(renamedDoc(before, "Sensor", "Sensor1", "Cam"), makeTree({ sensors: { G01: ["Cam"] } }));
    expect(titles()).toEqual([title("Cam", "G01")]);
    expect(messages("SENSOR_VIEW_CLOSED")).toEqual([]);
  });

  test("workbook sensor view for a missing sensor is closed with a message", async () => {
    await mount({ G01: ["Sensor1"], G02: ["Sensor2"] });
    await open("Sensor1");
    await open("Sensor2");
    const workbook = useLayout.getState().toWorkbook();
    expect(Object.values(workbook.panels).filter((p) => p.kind === "sensorView")).toHaveLength(2); // บันทึกใน workbook
    // เปิดอีก scenario (ชื่อใหม่) ที่ไม่มี Sensor1: หน้าต่างของ scenario เดิมรอ workbook ใหม่มาแทน ไม่ถูกปิดพร้อมข้อความ
    act(() => useScenario.setState({ name: "S2", doc: makeScenarioDoc({ name: "S2" }, { G02: ["Sensor2"] }), tree: makeTree({ sensors: { G02: ["Sensor2"] } }) }));
    expect(views()).toHaveLength(2);
    // doc ของ S2 โหลดใหม่ (event) ก่อน workbook ของมันมาถึง: หน้าต่างของ S1 ไม่ถูกตรวจกับ S2
    serverSends(makeScenarioDoc({ name: "S2" }, { G02: ["Sensor2"] }), makeTree({ sensors: { G02: ["Sensor2"] } }));
    expect(views()).toHaveLength(2);
    expect(messages("SENSOR_VIEW_CLOSED")).toEqual([]);
    act(() => useLayout.getState().fromWorkbook(workbook));
    await waitFor(() => expect(titles()).toEqual([title("Sensor2", "G02")]));
    expect(messages("SENSOR_VIEW_CLOSED").map((m) => [m.level, m.text])).toEqual([["warning", msg("sensorView.closedMissing", { sensor: "Sensor1" })]]);
  });
});

describe("cone circle", () => {
  test("is the cone edge as a fraction of half the short side, beyond it when the fov is capped, and none at 90°", () => {
    const rad = Math.PI / 180;
    expect(coneCircleRadius(10)).toBeCloseTo(Math.tan(10 * rad) / Math.tan(10.5 * rad), 12);
    expect(coneCircleRadius(14.38)).toBeLessThan(1);
    expect(coneCircleRadius(60)).toBeCloseTo(1, 12); // fov ด้านสั้น 120° พอดี
    expect(coneCircleRadius(75)).toBeCloseTo(Math.tan(75 * rad) / Math.tan(60 * rad), 12);
    expect(coneCircleRadius(90)).toBeNull();
  });
});

test("the Sensor View window, its commands, track.ts and the test hooks load no Cesium (only scene3d, imported on demand, does)", () => {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    expect(source, file).not.toMatch(/from\s+["']cesium["']/);
    for (const m of source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["'](\.{1,2}\/[^"']+)["']/gms)) {
      const base = resolve(dirname(file), m[1]);
      const next = [`${base}.ts`, `${base}.tsx`].find((f) => existsSync(f));
      if (next !== undefined) visit(next);
    }
  };
  const src = resolve(import.meta.dirname, "../../src");
  for (const f of ["windows/SensorView/SensorView.tsx", "windows/SensorView/commands.ts", "windows/SensorView/track.ts", "cesium/testHooks.ts"]) {
    visit(resolve(src, f));
  }
  expect([...seen].some((f) => f.endsWith("Graphics3D/scene3d.ts"))).toBe(false);
  expect(seen.size).toBeGreaterThan(10);
});
