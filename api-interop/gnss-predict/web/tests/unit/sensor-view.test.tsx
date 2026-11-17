// หน้าต่าง Sensor View (sensor spec §5.4) ส่วน React, การตามต้นไม้ของ scenario (track.ts) และ test hook โดยไม่วาด Cesium:
// การสร้าง viewer (scene3d.mountSensorView) ถูกแทนด้วยตัวปลอมที่ทำตาม SensorViewHandle และ jsdom ได้ WebGLRenderingContext ปลอม
// หน้าต่างเปิดใน Workspace จริง (dockview) เพราะชื่อหน้าต่าง params และการปิดเป็นเรื่องของ dockview

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import userEvent from "@testing-library/user-event";
import type { DockviewApi, IDockviewPanel } from "dockview-react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { sensorViewGroundWidthM, sensorViewGroundWidthRangeM, sensorViewShortFovDeg, sensorViewZoomForGroundWidth } from "../../src/cesium/sensorGeometry";
import { installTestHooks } from "../../src/cesium/testHooks";
import { runCommand } from "../../src/commands";
import { t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { useLayout } from "../../src/stores/layout";
import { useImagery } from "../../src/stores/imagery";
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
  sensorViewParams, sensorViewScenes, type SensorCamera, type SensorHud, type SensorViewDisplay, type SensorViewHandle, type SensorViewUp,
  type SensorViewZoom,
} from "../../src/windows/SensorView/registry";
import { nextZoom, parseGroundWidth, snapZoomIndex, ZOOM_GRID, ZOOM_MAX, zoomText } from "../../src/windows/SensorView/zoom";
import { coneCircleRadius, finestLevelReached, groundWidthText, registerSensorViewPanel } from "../../src/windows/SensorView/SensorView";
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
    viewFromSensor: (path: string, up: SensorViewUp, display: SensorViewDisplay, zoom: SensorViewZoom) => {
      calls.push(["viewFromSensor", path, up, display, zoom]);
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

const HUD: SensorHud = {
  sensor: "Sensor1", satellite: "G01", lat: 13.456, lon: -100.004, altKm: 20180.6, shape: "Simple Conic", halfAngles: null, coneHalfAngle: 14.38, fovDeg: 30.198, zoom: 1,
  imagery: null, shortSidePx: 600,
};
/** MODIS บน Terra (ข2 Ruling e, g): Rectangular V 55.0 / H 0.41 ครึ่งมุมของภาพ = max(V, H) */
const HUD_RECT: SensorHud = {
  ...HUD, sensor: "MODIS", satellite: "X04", altKm: 705, shape: "Rectangular", halfAngles: { vertical: 55.0, horizontal: 0.41 }, coneHalfAngle: 55, fovDeg: 115.5,
};

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
  vi.restoreAllMocks();
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
/** params ของหน้าต่างใหม่: Up = North, Display = Camera, ×1 (imagery spec §5.3) */
const NEW = (sensor: string) => ({ path: sensorPath(sensor), up: "north", display: "camera", zoom: 1 });

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
    expect(first.calls).toContainEqual(["viewFromSensor", sensorPath("Sensor1"), "north", "camera", 1]);
    act(() => void openSensorView(sensorPath("Sensor1"))); // เปิดซ้ำ = บานเดิม
    expect(titles()).toEqual([title("Sensor1", "G01")]);
    await open("Sensor2");
    expect(titles()).toEqual([title("Sensor1", "G01"), title("Sensor2", "G02")]);
    expect(views().map((p) => p.params)).toEqual([NEW("Sensor1"), NEW("Sensor2")]);
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
    expect(views()[0].params).toEqual({ ...NEW("Sensor1"), up: "velocity" });
    await waitFor(() => expect(fake.calls.at(-1)).toEqual(["viewFromSensor", sensorPath("Sensor1"), "velocity", "camera", 1]));
    expect(within(bar).getByRole("button", { name: t("sensorView.up.velocity") }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(bar).getByRole("button", { name: t("sensorView.up.north") }));
    expect(views()[0].params).toEqual(NEW("Sensor1"));
    await waitFor(() => expect(fake.calls.at(-1)).toEqual(["viewFromSensor", sensorPath("Sensor1"), "north", "camera", 1]));
    // เปิดซ้ำจากเมนูไม่ล้างค่า Up ที่เลือกไว้
    await user.click(within(bar).getByRole("button", { name: t("sensorView.up.velocity") }));
    act(() => void openSensorView(sensorPath("Sensor1")));
    expect(views()[0].params).toEqual({ ...NEW("Sensor1"), up: "velocity" });
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
    expect(lines).toContain(msg("sensorView.hudFov", { fov: "30.2", zoom: 1 }));
    expect(lines).toContain(msg("sensorView.hudImageryOffline"));
    expect(screen.queryByText(msg("sensorView.noPosition", { satellite: "G01" }))).toBeNull();
  });

  test("the cone circle is drawn in Sensor display only, sized by the zoomed fov", async () => {
    const user = userEvent.setup();
    await mount({ G01: ["Sensor1"] });
    await open("Sensor1");
    await screen.findByTestId("sensor-view-hud");
    expect(document.querySelector(".sensor-view-cone")).toBeNull(); // Camera (ตั้งต้น) ไม่มีวงขอบกรวย
    await user.click(screen.getByRole("button", { name: t("sensorView.display.sensor") }));
    // วงขอบกรวย: รัศมีเทียบครึ่งด้านสั้นของภาพ
    const circle = () => document.querySelector(".sensor-view-cone circle");
    await waitFor(() => expect(Number(circle()?.getAttribute("r"))).toBeCloseTo(coneCircleRadius(14.38)!, 9));
    await user.click(screen.getByRole("button", { name: t("toolbar.zoomIn") }));
    await waitFor(() => expect(Number(circle()?.getAttribute("r"))).toBeCloseTo(coneCircleRadius(14.38, Math.SQRT2)!, 9));
  });

  test("a Rectangular sensor: no cone circle in Sensor display, and the HUD shows both half angles instead of the cone", async () => {
    const user = userEvent.setup();
    nextHud = HUD_RECT;
    await mount({ G01: ["Sensor1"] });
    await open("Sensor1");
    const hud = await screen.findByTestId("sensor-view-hud");
    await user.click(screen.getByRole("button", { name: t("sensorView.display.sensor") }));
    await waitFor(() => expect(views()[0].params).toMatchObject({ display: "sensor" }));
    expect(document.querySelector(".sensor-view-cone")).toBeNull();
    const lines = within(hud).getAllByText(/.+/).map((el) => el.textContent);
    expect(lines).toContain(msg("sensorView.hudRect", { v: "55.0", h: "0.4" }));
    expect(hud.textContent).toContain("Vertical 55.0° × Horizontal 0.4°");
    expect(hud.textContent).not.toContain("Cone Half Angle");
    expect(lines).toContain(msg("sensorView.hudFov", { fov: "115.5", zoom: 1 }));
  });

  test("Display: new windows start in Camera; Sensor and back are stored in the params and sent to the scene", async () => {
    const user = userEvent.setup();
    await mount({ G01: ["Sensor1"] });
    const fake = await open("Sensor1");
    const bar = screen.getByRole("group", { name: t("sensorView.display") });
    const camera = within(bar).getByRole("button", { name: t("sensorView.display.camera") });
    const sensor = within(bar).getByRole("button", { name: t("sensorView.display.sensor") });
    expect(camera.getAttribute("aria-pressed")).toBe("true");
    expect(sensor.getAttribute("aria-pressed")).toBe("false");
    await user.click(sensor);
    expect(views()[0].params).toEqual({ ...NEW("Sensor1"), display: "sensor" });
    await waitFor(() => expect(fake.calls.at(-1)).toEqual(["viewFromSensor", sensorPath("Sensor1"), "north", "sensor", 1]));
    expect(within(bar).getByRole("button", { name: t("sensorView.display.sensor") }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(bar).getByRole("button", { name: t("sensorView.display.camera") }));
    expect(views()[0].params).toEqual(NEW("Sensor1"));
    await waitFor(() => expect(fake.calls.at(-1)).toEqual(["viewFromSensor", sensorPath("Sensor1"), "north", "camera", 1]));
    // เปิดซ้ำจากเมนูไม่ล้าง Display และ zoom
    await user.click(within(bar).getByRole("button", { name: t("sensorView.display.sensor") }));
    await user.click(screen.getByRole("button", { name: t("toolbar.zoomIn") }));
    act(() => void openSensorView(sensorPath("Sensor1")));
    expect(views()[0].params).toEqual({ ...NEW("Sensor1"), display: "sensor", zoom: Math.SQRT2 });
  });

  test("Zoom In steps by ×√2: six clicks give ×8, twenty-six ×8192, thirty-six the ×262144 end; the ends disable the buttons", async () => {
    const user = userEvent.setup();
    await mount({ G01: ["Sensor1"] });
    const fake = await open("Sensor1");
    const zoomIn = () => screen.getByRole("button", { name: t("toolbar.zoomIn") });
    const zoomOut = () => screen.getByRole("button", { name: t("toolbar.zoomOut") });
    const bar = screen.getByRole("group", { name: t("sensorView.zoom") });
    expect(within(bar).getByText("×1")).toBeDefined();
    expect((zoomOut() as HTMLButtonElement).disabled).toBe(true);
    await user.click(zoomIn());
    expect(views()[0].params?.zoom).toBe(Math.SQRT2);
    expect(within(bar).getByText("×1.4")).toBeDefined();
    for (let i = 0; i < 5; i++) await user.click(zoomIn());
    expect(views()[0].params).toEqual({ ...NEW("Sensor1"), zoom: 8 });
    expect(within(bar).getByText("×8")).toBeDefined();
    await waitFor(() => expect(fake.calls.at(-1)).toEqual(["viewFromSensor", sensorPath("Sensor1"), "north", "camera", 8]));
    for (let i = 0; i < 20; i++) await user.click(zoomIn());
    expect(views()[0].params?.zoom).toBe(8192);
    expect(within(bar).getByText("×8192")).toBeDefined();
    expect((zoomIn() as HTMLButtonElement).disabled).toBe(false);
    await waitFor(() => expect(fake.calls.at(-1)).toEqual(["viewFromSensor", sensorPath("Sensor1"), "north", "camera", 8192]));
    for (let i = 0; i < 10; i++) await user.click(zoomIn());
    expect(views()[0].params?.zoom).toBe(ZOOM_MAX);
    expect(within(bar).getByText("×262k")).toBeDefined();
    expect((zoomIn() as HTMLButtonElement).disabled).toBe(true);
    await user.click(zoomOut());
    await user.click(zoomOut());
    expect(views()[0].params?.zoom).toBe(131072);
  });

  // QA-03: คำแนะนำของช่อง Width ยาวกว่าแถบ (1280 px ก็ไม่พอ) ต้องเห็นครบ: แถวของตัวเองใต้แถบเครื่องมือ ตัดบรรทัดได้ ไม่อยู่ในแถบที่ไม่ตัดบรรทัด
  test("the Width hint is shown in full: a wrapping row of its own under the toolbar row, not clipped inside the zoom group", async () => {
    const user = userEvent.setup();
    await mount({ G01: ["Sensor1"] });
    await open("Sensor1");
    await screen.findByTestId("sensor-view-hud");
    const bar = screen.getByRole("group", { name: t("sensorView.zoom") });
    const box = within(bar).getByRole("textbox", { name: t("sensorView.width") }) as HTMLInputElement;
    await user.clear(box);
    await user.type(box, "abc{Enter}");
    const hint = screen.getByText(msg("sensorView.widthInvalid"));
    expect(hint.textContent).toBe(msg("sensorView.widthInvalid")); // ข้อความเต็มอยู่ใน DOM
    expect(hint.getAttribute("role")).toBe("status");
    expect(hint.closest(".toolbar")).toBeNull(); // ไม่อยู่ในแถบ (flex แถวเดียว) ของ Zoom/Width
    expect(hint.parentElement?.classList.contains("gfx-toolbars")).toBe(true); // แถบเครื่องมือของหน้าต่างตัดแถวได้ (flex-wrap)
    expect(hint.getAttribute("style")).toBeNull();
    // กฎ CSS ของคำแนะนำ: ไม่มี nowrap / overflow hidden / ellipsis และกินเต็มความกว้าง (ขึ้นแถวใหม่ใต้แถบ)
    const css = readFileSync(resolve(__dirname, "../../src/theme.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, sel]) => sel.split(",").some((s) => s.trim() === ".sensor-view-width-hint"));
    expect(rules.length).toBeGreaterThan(0);
    const body = rules.map(([, , b]) => b).join(";");
    expect(body).not.toMatch(/white-space:\s*nowrap/);
    expect(body).not.toMatch(/overflow:\s*hidden/);
    expect(body).not.toMatch(/text-overflow/);
    expect(body).toMatch(/white-space:\s*normal/);
    expect(body).toMatch(/flex:\s*1 0 100%/);
  });

  test("the Width box shows the ground width now; Enter sets the zoom that gives the typed width at the sub-point; bad input reverts with a Thai hint", async () => {
    const user = userEvent.setup();
    await mount({ G01: ["Sensor1"] });
    const fake = await open("Sensor1");
    await screen.findByTestId("sensor-view-hud");
    const bar = screen.getByRole("group", { name: t("sensorView.zoom") });
    const box = () => within(bar).getByRole("textbox", { name: t("sensorView.width") }) as HTMLInputElement;
    const nowText = (hud: SensorHud) => {
      const { unit, width } = groundWidthText(sensorViewGroundWidthM(hud.altKm, hud.fovDeg));
      return `${width} ${unit}`;
    };
    await waitFor(() => expect(box().value).toBe(nowText(HUD)));
    await user.clear(box());
    await user.type(box(), "1.5 km{Enter}");
    const zoom = views()[0].params?.zoom as number;
    expect(zoom).toBeCloseTo(sensorViewZoomForGroundWidth(HUD.altKm, HUD.coneHalfAngle, 1500)!, 9);
    const width = sensorViewGroundWidthM(HUD.altKm, sensorViewShortFovDeg(HUD.coneHalfAngle, zoom));
    expect(Math.abs(width - 1500) / 1500).toBeLessThan(0.01);
    await waitFor(() => expect(fake.calls.at(-1)).toEqual(["viewFromSensor", sensorPath("Sensor1"), "north", "camera", zoom]));
    expect(screen.queryByText(msg("sensorView.widthInvalid"))).toBeNull();
    // ภาพตามซูมใหม่: ช่องแสดงความกว้างตอนนี้
    fake.hud = { ...HUD, fovDeg: sensorViewShortFovDeg(HUD.coneHalfAngle, zoom), zoom };
    act(() => sensorViewScenes.notify());
    await waitFor(() => expect(box().value).toBe("1.50 km"));
    // พิมพ์ผิด: ช่องกลับเป็นค่าเดิม ซูมไม่เปลี่ยน คำแนะนำภาษาไทย
    await user.clear(box());
    await user.type(box(), "abc{Enter}");
    expect(box().value).toBe("1.50 km");
    expect(views()[0].params?.zoom).toBe(zoom);
    expect(screen.getByText(msg("sensorView.widthInvalid"))).toBeDefined();
    expect(msg("sensorView.widthInvalid")).toMatch(/[฀-๿]/);
    // ค่าที่แคบเกินช่วงซูม = ×262144 ; กว้างกว่าภาพที่ ×1 = ×1
    await user.clear(box());
    await user.type(box(), "1 m{Enter}");
    expect(views()[0].params?.zoom).toBe(ZOOM_MAX);
    expect(screen.queryByText(msg("sensorView.widthInvalid"))).toBeNull();
    await user.clear(box());
    await user.type(box(), "100000 km{Enter}");
    expect(views()[0].params?.zoom).toBe(1);
    // ดาวไม่มีตำแหน่ง: ตั้งไม่ได้ บอกเหตุผลเป็นภาษาไทย
    fake.hud = null;
    act(() => sensorViewScenes.notify());
    await user.clear(box());
    await user.type(box(), "500{Enter}");
    expect(views()[0].params?.zoom).toBe(1);
    expect(screen.getByText(msg("sensorView.widthNoPosition"))).toBeDefined();
  });

  test("the Width box: a width the current altitude cannot reach is clamped with a Thai hint naming the reachable min and max; a width in range gives no hint", async () => {
    const user = userEvent.setup();
    await mount({ G01: ["Sensor1"] });
    await open("Sensor1");
    await screen.findByTestId("sensor-view-hud");
    const bar = screen.getByRole("group", { name: t("sensorView.zoom") });
    const box = () => within(bar).getByRole("textbox", { name: t("sensorView.width") }) as HTMLInputElement;
    const range = sensorViewGroundWidthRangeM(HUD.altKm, HUD.coneHalfAngle, 1, ZOOM_MAX)!;
    const text = (metres: number) => {
      const { unit, width } = groundWidthText(metres);
      return `${width} ${unit}`;
    };
    const hint = msg("sensorView.widthClamped", { min: text(range.minM), max: text(range.maxM) });
    expect(hint).toMatch(/[฀-๿]/);
    expect(hint).toContain(text(range.minM));
    expect(hint).toContain(text(range.maxM));
    await user.clear(box());
    await user.type(box(), "1.5 km{Enter}");
    expect(screen.queryByText(hint)).toBeNull();
    await user.clear(box());
    await user.type(box(), "1 m{Enter}");
    expect(views()[0].params?.zoom).toBe(ZOOM_MAX);
    expect(screen.getByText(hint)).toBeDefined();
    await user.clear(box());
    await user.type(box(), "100000 km{Enter}");
    expect(views()[0].params?.zoom).toBe(1);
    expect(screen.getByText(hint)).toBeDefined();
    // ค่าที่ปลายช่วงพอดีเอื้อมถึง = ไม่ต้องบอก
    await user.clear(box());
    await user.type(box(), `${range.maxM}{Enter}`);
    expect(views()[0].params?.zoom).toBe(1);
    expect(screen.queryByText(hint)).toBeNull();
  });

  test("the Width hint goes away when the zoom changes by the buttons or by the wheel (also the invalid-input and no-position hints)", async () => {
    const user = userEvent.setup();
    await mount({ G01: ["Sensor1"] });
    const fake = await open("Sensor1");
    await screen.findByTestId("sensor-view-hud");
    const bar = screen.getByRole("group", { name: t("sensorView.zoom") });
    const box = () => within(bar).getByRole("textbox", { name: t("sensorView.width") }) as HTMLInputElement;
    const range = sensorViewGroundWidthRangeM(HUD.altKm, HUD.coneHalfAngle, 1, ZOOM_MAX)!;
    const text = (metres: number) => {
      const { unit, width } = groundWidthText(metres);
      return `${width} ${unit}`;
    };
    const clamped = msg("sensorView.widthClamped", { min: text(range.minM), max: text(range.maxM) });
    const typeWidth = async (value: string) => {
      await user.clear(box());
      await user.type(box(), `${value}{Enter}`);
    };
    let clock = 10_000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const stage = screen.getByTestId("sensor-view");
    const notch = (deltaY: number) => {
      clock += 300;
      act(() => void fireEvent.wheel(stage, { deltaY }));
    };
    // ปุ่ม Zoom Out หลังถูกบีบที่ ×262144
    await typeWidth("1 m");
    expect(screen.getByText(clamped)).toBeDefined();
    await user.click(screen.getByRole("button", { name: t("toolbar.zoomOut") }));
    expect(screen.queryByText(clamped)).toBeNull();
    // ปุ่ม Zoom In หลังคำแนะนำพิมพ์ผิด (ซูมไม่เปลี่ยนตอนแสดงคำแนะนำ)
    await typeWidth("abc");
    expect(screen.getByText(msg("sensorView.widthInvalid"))).toBeDefined();
    await user.click(screen.getByRole("button", { name: t("toolbar.zoomIn") }));
    expect(screen.queryByText(msg("sensorView.widthInvalid"))).toBeNull();
    // ล้อเมาส์หลังถูกบีบที่ ×1
    await typeWidth("100000 km");
    expect(views()[0].params?.zoom).toBe(1);
    expect(screen.getByText(clamped)).toBeDefined();
    notch(-100);
    expect(views()[0].params?.zoom).toBe(Math.SQRT2);
    expect(screen.queryByText(clamped)).toBeNull();
    // ล้อเมาส์หลังคำแนะนำ "ไม่มีตำแหน่ง"
    fake.hud = null;
    act(() => sensorViewScenes.notify());
    await typeWidth("500");
    expect(screen.getByText(msg("sensorView.widthNoPosition"))).toBeDefined();
    notch(-100);
    expect(screen.queryByText(msg("sensorView.widthNoPosition"))).toBeNull();
    // ตั้งความกว้างซ้ำที่ซูมเดิมยังแสดงคำแนะนำ (ซูมไม่เปลี่ยนก็ไม่ถูกล้างเอง)
    fake.hud = HUD;
    act(() => sensorViewScenes.notify());
    await typeWidth("1 m");
    expect(screen.getByText(clamped)).toBeDefined();
    await typeWidth("1 m");
    expect(screen.getByText(clamped)).toBeDefined();
  });

  test("the mouse wheel without Shift zooms (and does not scroll the page); with Shift it does not zoom", async () => {
    await mount({ G01: ["Sensor1"] });
    const fake = await open("Sensor1");
    const stage = screen.getByTestId("sensor-view");
    // นาฬิกาของตัวสะสมล้อ (wheelZoom.ts): รอยล้อห่างกัน 300 ms = ขั้นละรอย
    let clock = 10_000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const notch = (deltaY: number, init: Partial<WheelEventInit> = {}): boolean => {
      clock += 300;
      let notPrevented = true;
      act(() => void (notPrevented = fireEvent.wheel(stage, { deltaY, ...init })));
      return notPrevented;
    };
    expect(notch(-100)).toBe(false); // preventDefault: หน้าไม่เลื่อน
    expect(views()[0].params?.zoom).toBe(Math.SQRT2); // หนึ่งรอย = ×√2
    notch(-100);
    expect(views()[0].params?.zoom).toBe(2);
    notch(-100);
    notch(100);
    expect(views()[0].params?.zoom).toBe(2);
    await waitFor(() => expect(fake.calls.at(-1)).toEqual(["viewFromSensor", sensorPath("Sensor1"), "north", "camera", 2]));
    notch(-100, { shiftKey: true });
    notch(100, { shiftKey: true });
    expect(views()[0].params?.zoom).toBe(2);
    // ปลายทั้งสองไม่เลยช่วง
    for (let i = 0; i < 5; i++) notch(100);
    expect(views()[0].params?.zoom).toBe(1);
  });

  test("a trackpad swipe (many small wheel events) or a pinch (ctrlKey) moves the zoom by at most a couple of steps, not to the ×8192 end", async () => {
    await mount({ G01: ["Sensor1"] });
    await open("Sensor1");
    const stage = screen.getByTestId("sensor-view");
    let clock = 10_000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    // ปัดนิ้ว: 30 เหตุการณ์ deltaY −40 ห่างกัน 10 ms
    for (let i = 0; i < 30; i++) {
      act(() => void fireEvent.wheel(stage, { deltaY: -40 }));
      clock += 10;
    }
    const afterSwipe = views()[0].params?.zoom as number;
    expect(afterSwipe).toBeGreaterThanOrEqual(2);
    expect(afterSwipe).toBeLessThanOrEqual(4);
    // นิ้วสัมผัสเบา ๆ: 20 เหตุการณ์ −4 ภายใน 100 ms ไม่ซูม
    clock += 1000;
    for (let i = 0; i < 20; i++) {
      act(() => void fireEvent.wheel(stage, { deltaY: -4 }));
      clock += 5;
    }
    expect(views()[0].params?.zoom).toBe(afterSwipe);
    // pinch ออก (ctrlKey) ทางเดียวกัน: หน้าไม่ซูมทั้งหน้า (preventDefault)
    clock += 1000;
    let notPrevented = true;
    for (let i = 0; i < 30; i++) {
      act(() => void (notPrevented = fireEvent.wheel(stage, { deltaY: 40, ctrlKey: true })));
      clock += 10;
    }
    expect(notPrevented).toBe(false);
    const afterPinch = views()[0].params?.zoom as number;
    expect(afterPinch).toBeLessThan(afterSwipe);
    expect(afterPinch).toBeGreaterThanOrEqual(afterSwipe / 4);
  });

  test("HUD: FOV line, imagery source line (top layer, missing, offline) and the Globe Manager hint", async () => {
    const user = userEvent.setup();
    await mount({ G01: ["Sensor1"] });
    const fake = await open("Sensor1");
    const hud = await screen.findByTestId("sensor-view-hud");
    const lines = () => within(screen.getByTestId("sensor-view-hud")).getAllByText(/.+/).map((el) => el.textContent);
    expect(hud).toBeDefined();
    expect(lines()).toContain(msg("sensorView.hudImageryOffline"));
    expect(msg("sensorView.hudImageryOffline")).toBe("ภาพพื้นโลก: Natural Earth II (ออฟไลน์)");
    // ซูม ≥ 8 ในโหมด Camera และสวิตช์ปิด: แนะนำ Globe Manager
    expect(lines()).not.toContain(msg("sensorView.hintGlobeManager"));
    for (let i = 0; i < 6; i++) await user.click(screen.getByRole("button", { name: t("toolbar.zoomIn") }));
    fake.hud = { ...HUD, fovDeg: 30.198 / 8, zoom: 8 };
    act(() => sensorViewScenes.notify());
    await waitFor(() => expect(lines()).toContain(msg("sensorView.hintGlobeManager")));
    expect(lines()).toContain(msg("sensorView.hudFov", { fov: "3.8", zoom: 8 }));
    expect(msg("sensorView.hintGlobeManager")).toBe("เปิดภาพจริงได้ที่ View → Globe Manager");
    // โหมด Sensor ไม่แนะนำ
    await user.click(screen.getByRole("button", { name: t("sensorView.display.sensor") }));
    await waitFor(() => expect(lines()).not.toContain(msg("sensorView.hintGlobeManager")));
    await user.click(screen.getByRole("button", { name: t("sensorView.display.camera") }));
    await waitFor(() => expect(lines()).toContain(msg("sensorView.hintGlobeManager")));
    // สวิตช์เปิด: ชั้นบนสุดที่แสดง ไม่มีคำแนะนำ
    fake.hud = { ...fake.hud, imagery: { title: "VIIRS NOAA-20 True Color", label: "2026-11-11", missing: false, source: "gibs", maxLevel: 9 } };
    act(() => useImagery.setState({ sources: { gibs: true, eox: false, osm: false, ion: false } }));
    await waitFor(() => expect(lines()).toContain(msg("sensorView.hudImagery", { image: "VIIRS NOAA-20 True Color 2026-11-11" })));
    expect(lines()).toContain("ภาพพื้นโลก: VIIRS NOAA-20 True Color 2026-11-11");
    expect(lines()).not.toContain(msg("sensorView.hintGlobeManager"));
    // ชั้นบนสุดไม่มีภาพเกินครึ่ง: ต่อท้าย (HUD อ่านใหม่เองเป็นระยะ ไม่ต้องรอเวลาเปลี่ยน)
    fake.hud = { ...fake.hud, imagery: { title: "Blue Marble", label: "", missing: true, source: "gibs", maxLevel: 8 } };
    await waitFor(() => expect(lines()).toContain("ภาพพื้นโลก: Blue Marble — ไม่มีภาพเวลานี้"), { timeout: 3000 });
    act(() => useImagery.setState({ sources: { gibs: false, eox: false, osm: false, ion: false } }));
  });

  test("the Globe Manager hint shows whenever no online layer is actually shown, even with a source switch on (ion without asset, or its layers hidden)", async () => {
    const user = userEvent.setup();
    await mount({ G01: ["Sensor1"] });
    const fake = await open("Sensor1");
    await screen.findByTestId("sensor-view-hud");
    const lines = () => within(screen.getByTestId("sensor-view-hud")).getAllByText(/.+/).map((el) => el.textContent);
    for (let i = 0; i < 6; i++) await user.click(screen.getByRole("button", { name: t("toolbar.zoomIn") }));
    try {
      for (const sources of [{ gibs: false, eox: false, osm: false, ion: true }, { gibs: true, eox: true, osm: true, ion: false }]) {
        act(() => useImagery.setState({ sources }));
        fake.hud = { ...HUD, fovDeg: 30.198 / 8, zoom: 8, imagery: null };
        act(() => sensorViewScenes.notify());
        await waitFor(() => expect(lines()).toContain(msg("sensorView.hintGlobeManager")));
        expect(lines()).toContain(msg("sensorView.hudImageryOffline"));
        // ชั้นออนไลน์แสดงจริง: ไม่แนะนำ
        fake.hud = { ...fake.hud, imagery: { title: "OpenStreetMap", label: "", missing: false, source: "osm", maxLevel: 19 } };
        act(() => sensorViewScenes.notify());
        await waitFor(() => expect(lines()).not.toContain(msg("sensorView.hintGlobeManager")));
      }
    } finally {
      act(() => useImagery.setState({ sources: { gibs: false, eox: false, osm: false, ion: false } }));
    }
  });

  test("HUD flags OpenStreetMap or Cesium ion tiles that do not load as tiles that failed to load, not as no imagery for this time", async () => {
    await mount({ G01: ["Sensor1"] });
    const fake = await open("Sensor1");
    await screen.findByTestId("sensor-view-hud");
    const lines = () => within(screen.getByTestId("sensor-view-hud")).getAllByText(/.+/).map((el) => el.textContent);
    for (const source of ["osm", "ion"] as const) {
      fake.hud = { ...HUD, imagery: { title: "OpenStreetMap", label: "", missing: true, source, maxLevel: 19 } };
      act(() => sensorViewScenes.notify());
      await waitFor(() => expect(lines()).toContain(msg("sensorView.hudImageryFailed", { image: "OpenStreetMap" })));
    }
    expect(msg("sensorView.hudImageryFailed", { image: "OpenStreetMap" })).toBe("ภาพพื้นโลก: OpenStreetMap — ชิ้นภาพส่วนใหญ่โหลดไม่ได้");
  });

  test("HUD shows the ground width at the sub-satellite point: km above 1 km, m below (imagery spec §4.4)", async () => {
    await mount({ G01: ["Sensor1"] });
    const fake = await open("Sensor1");
    await screen.findByTestId("sensor-view-hud");
    const lines = () => within(screen.getByTestId("sensor-view-hud")).getAllByText(/.+/).map((el) => el.textContent);
    const show = async (hud: SensorHud, line: string) => {
      fake.hud = hud;
      act(() => sensorViewScenes.notify());
      await waitFor(() => expect(lines()).toContain(line));
    };
    // ดาว GPS (20,200 km, α 14.4°): ×1024 ≈ 10 km, ×8192 ≈ 1.3 km
    const gps = (zoom: number): SensorHud => ({ ...HUD, altKm: 20200, coneHalfAngle: 14.4, fovDeg: sensorViewShortFovDeg(14.4, zoom), zoom: zoom as SensorViewZoom });
    await show(gps(1024), msg("sensorView.hudGroundWidthKm", { width: "10.4" }));
    await show(gps(8192), msg("sensorView.hudGroundWidthKm", { width: "1.30" }));
    // FOV ต่ำกว่า 1° เป็นเลขนัยสำคัญ 2 ตัว: ×8192 ≈ 0.0037° ไม่ปัดเป็น 0.00; ×1024 ≈ 0.0295°; ×128 ≈ 0.24°; ×262144 ≈ 0.000115° (อ่านได้ ไม่เป็น 0.0001)
    expect(lines()).toContain(msg("sensorView.hudFov", { fov: "0.0037", zoom: 8192 }));
    await show(gps(1024), msg("sensorView.hudFov", { fov: "0.030", zoom: 1024 }));
    await show(gps(128), msg("sensorView.hudFov", { fov: "0.24", zoom: 128 }));
    await show(gps(262144), msg("sensorView.hudFov", { fov: "0.00012", zoom: "262k" }));
    await show(gps(Math.SQRT2), msg("sensorView.hudFov", { fov: "21.4", zoom: "1.4" }));
    await show(gps(1024), msg("sensorView.hudGroundWidthKm", { width: "10.4" }));
    // ×1: กว้างกว่าจานโลก = ขอบฟ้า (หลักหมื่น km ไม่ทศนิยม)
    const full = gps(1);
    await show(full, msg("sensorView.hudGroundWidthKm", { width: String(Math.round(sensorViewGroundWidthM(20200, full.fovDeg) / 1000)) }));
    // ต่ำกว่า 1 km: เมตร
    await show({ ...HUD, altKm: 800, fovDeg: 0.02, zoom: 8192 }, msg("sensorView.hudGroundWidthM", { width: "279" }));
    // ข้อความไทย และไม่มีบรรทัดความกว้างเมื่อมองไม่เห็นพื้นที่ (fov = 0)
    expect(msg("sensorView.hudGroundWidthKm", { width: "10.4" })).toBe("ความกว้างพื้นที่ที่จุดใต้ดาวโดยประมาณ 10.4 km");
    expect(msg("sensorView.hudGroundWidthM", { width: "279" })).toBe("ความกว้างพื้นที่ที่จุดใต้ดาวโดยประมาณ 279 m");
  });

  test("HUD says the source is at its finest level only when the shown GIBS/EOX/OSM layer is shallower than the view needs; ion never", async () => {
    await mount({ G01: ["Sensor1"] });
    const fake = await open("Sensor1");
    await screen.findByTestId("sensor-view-hud");
    const lines = () => within(screen.getByTestId("sensor-view-hud")).getAllByText(/.+/).map((el) => el.textContent);
    const gps = (zoom: number, imagery: SensorHud["imagery"], shortSidePx = 600): SensorHud => ({
      ...HUD, altKm: 20200, coneHalfAngle: 14.4, fovDeg: sensorViewShortFovDeg(14.4, zoom), zoom: zoom as SensorViewZoom, imagery, shortSidePx,
    });
    const layer = (source: "gibs" | "eox" | "osm" | "ion", maxLevel: number | null) => ({ title: "L", label: "", missing: false, source, maxLevel });
    const note = (level: number) => msg("sensorView.hudFinestLevel", { level });
    const anyNote = () => lines().some((l) => l?.startsWith("ภาพละเอียดสุดของแหล่งนี้แล้ว"));
    /** ตั้ง HUD ใหม่แล้วตรวจว่าบอก "ภาพละเอียดสุด" ของระดับ level (หรือไม่บอกเลยเมื่อ level = null) */
    const set = async (hud: SensorHud, level: number | null) => {
      fake.hud = hud;
      act(() => sensorViewScenes.notify());
      if (level === null) await waitFor(() => expect(anyNote()).toBe(false));
      else await waitFor(() => expect(lines()).toContain(note(level)));
    };
    // ×1024 ดาว GPS 600 px: ต้องใช้ระดับ 14 (Cesium พอใจที่ 13) > GIBS 9 = บอก
    await set(gps(1024, layer("gibs", 9)), 9);
    // ต้องการระดับ 7 ≤ 9 (×8): ไม่บอก
    await set(gps(8, layer("gibs", 9)), null);
    // ×8192 ต้องการระดับ 17 (Cesium พอใจที่ 16): EOX (15) บอก, OSM (19) ไม่บอก, ชั้นที่ละเอียดสุด 16 ไม่บอก (ภาพยังไม่เบลอ), 15 บอก
    await set(gps(8192, layer("eox", 15)), 15);
    await set(gps(8192, layer("osm", 19)), null);
    await set(gps(8192, layer("osm", 16)), null);
    await set(gps(8192, layer("osm", 15)), 15);
    // ion: ไม่รู้ระดับสูงสุด (หรือรู้แล้วก็ไม่เตือน) ไม่บอก
    await set(gps(8192, layer("ion", null)), null);
    await set(gps(8192, layer("ion", 12)), null);
    // ไม่มีชั้นออนไลน์ (Natural Earth II ออฟไลน์) หรือภาพยังไม่มีขนาด: ไม่บอก
    await set(gps(8192, null), null);
    await set(gps(8192, layer("gibs", 9), 0), null);
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
    fake.camera = { position: [1, 2, 3], direction: [0, 0, -1], up: [0, 1, 0], fovDeg: 31.5, display: "camera", zoom: 4, visibleEntityCount: 0 };
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
      expect(views().map((p) => p.params)).toEqual([NEW("Cam")]);
      expect(titles()).toEqual([title("Cam", "G01")]);
      await waitFor(() => expect(fake.calls.at(-1)).toEqual(["viewFromSensor", sensorPath("Cam"), "north", "camera", 1]));
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

describe("Sensor View params (imagery spec §5.3)", () => {
  test("display falls back to camera and zoom to 1 for missing or bad values", () => {
    expect(sensorViewParams({ path: "*/Sensor/S", up: "north" })).toEqual({ path: "*/Sensor/S", up: "north", display: "camera", zoom: 1 });
    expect(sensorViewParams({ path: "*/Sensor/S", display: "sensor", zoom: 8 })).toEqual({ path: "*/Sensor/S", up: "north", display: "sensor", zoom: 8 });
    expect(sensorViewParams({ zoom: 8192 }).zoom).toBe(8192);
    expect(sensorViewParams({ zoom: 128 }).zoom).toBe(128); // workbook เก่า (สูงสุด ×128) ยังเปิดได้
    expect(sensorViewParams({ display: "Sensor" }).display).toBe("camera");
    expect(sensorViewParams({ display: 1 }).display).toBe("camera");
    // zoom เป็นจำนวนต่อเนื่องใน [1, 262144] (ค่าจากช่อง Width ไม่อยู่บนตาราง ×√2) ค่าเดิมที่เป็นกำลังสองยังใช้ได้
    for (const ok of [1, 3, 12, 1.5, Math.SQRT2, 16384, 37.25, 262144]) expect(sensorViewParams({ zoom: ok }).zoom, String(ok)).toBe(ok);
    for (const bad of [0, 0.5, "8", -2, 262144.5, 1e9, Number.NaN, Number.POSITIVE_INFINITY, null, true]) {
      expect(sensorViewParams({ zoom: bad }).zoom, String(bad)).toBe(1);
    }
    expect(sensorViewParams(null)).toEqual({ path: "", up: "north", display: "camera", zoom: 1 });
  });

  test("the grid is 2^(k/2) for k = 0..36: powers of two exactly at even k, ×262144 at the end", () => {
    expect(ZOOM_GRID).toHaveLength(37);
    for (let k = 0; k <= 36; k++) expect(ZOOM_GRID[k]).toBeCloseTo(2 ** (k / 2), 9);
    for (let k = 0; k <= 36; k += 2) expect(ZOOM_GRID[k]).toBe(2 ** (k / 2));
    expect(ZOOM_GRID[1]).toBe(Math.SQRT2);
    expect(ZOOM_GRID[26]).toBe(8192);
    expect(ZOOM_GRID[36]).toBe(ZOOM_MAX);
    expect(ZOOM_MAX).toBe(262144);
  });

  test("nextZoom snaps to the nearest grid point first, then steps by ×√2, and stops at both ends", () => {
    expect(nextZoom(1, 1)).toBe(Math.SQRT2);
    expect(nextZoom(Math.SQRT2, 1)).toBe(2);
    expect(nextZoom(2, -1)).toBe(Math.SQRT2);
    expect(nextZoom(1, -1)).toBe(1);
    expect(nextZoom(4096, 1)).toBeCloseTo(4096 * Math.SQRT2, 6);
    expect(nextZoom(8192, -1)).toBeCloseTo(4096 * Math.SQRT2, 6);
    expect(nextZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(nextZoom(ZOOM_MAX, -1)).toBeCloseTo(131072 * Math.SQRT2, 3);
    // ค่าที่ไม่อยู่บนตาราง (จากช่อง Width): จุดที่ใกล้ที่สุดในสเกล log ก่อน แล้วจึงก้าว
    expect(snapZoomIndex(37.2)).toBe(10); // 2·log2(37.2) = 10.44 → 32
    expect(nextZoom(37.2, 1)).toBeCloseTo(32 * Math.SQRT2, 9);
    expect(nextZoom(37.2, -1)).toBeCloseTo(16 * Math.SQRT2, 9);
    expect(snapZoomIndex(1.1)).toBe(0);
    expect(nextZoom(1.1, -1)).toBe(1);
    expect(snapZoomIndex(200_000)).toBe(35);
    expect(nextZoom(200_000, 1)).toBe(ZOOM_MAX);
    // ไล่จาก ×1 ทีละขั้น: ขั้นที่ 2k เป็นกำลังสองพอดีเสมอ (ไม่สะสมความคลาด)
    let z = 1;
    for (let i = 1; i <= 36; i++) {
      z = nextZoom(z, 1);
      if (i % 2 === 0) expect(z).toBe(2 ** (i / 2));
    }
  });

  test("the toolbar label: whole numbers below 10000 exactly, one decimal below 10, whole numbers up to 9999, then thousands as k (cut, never rounded up)", () => {
    const cases: [number, string][] = [
      [1, "1"], [Math.SQRT2, "1.4"], [2, "2"], [2 * Math.SQRT2, "2.8"], [4 * Math.SQRT2, "5.7"], [8, "8"], [8 * Math.SQRT2, "11"], [64 * Math.SQRT2, "91"],
      [1024, "1024"], [1024 * Math.SQRT2, "1448"], [8192, "8192"], [8192 * Math.SQRT2, "11k"], [16384, "16k"], [65536, "65k"], [ZOOM_MAX, "262k"],
      [3.27, "3.3"], [9.96, "10"], [37.2, "37"], [9999.4, "9999"],
    ];
    for (const [z, text] of cases) expect(zoomText(z), String(z)).toBe(text);
    // ทุกจุดบนตารางได้ป้ายต่างกัน
    expect(new Set(ZOOM_GRID.map(zoomText)).size).toBe(ZOOM_GRID.length);
  });

  test("the Width box reads metres (no unit or m) and kilometres, with or without a space; anything else is not a width", () => {
    expect(parseGroundWidth("500 m")).toBe(500);
    expect(parseGroundWidth("500m")).toBe(500);
    expect(parseGroundWidth("500")).toBe(500);
    expect(parseGroundWidth(" 1.5 km ")).toBe(1500);
    expect(parseGroundWidth("1.5KM")).toBe(1500);
    expect(parseGroundWidth("0.25 km")).toBe(250);
    expect(parseGroundWidth(".5 km")).toBe(500);
    for (const bad of ["", "km", "abc", "0", "0 m", "-5 m", "1,5 km", "5 mi", "1e3", "Infinity", "1.5 km 2", "NaN"]) expect(parseGroundWidth(bad), bad).toBeNull();
  });
});

describe("cone circle", () => {
  test("follows the zoom: the short side is the cone fov / zoom", () => {
    const rad = Math.PI / 180;
    expect(coneCircleRadius(10, 4)).toBeCloseTo(Math.tan(10 * rad) / Math.tan((10.5 / 4) * rad), 12);
    expect(coneCircleRadius(10, 1)).toBeCloseTo(coneCircleRadius(10)!, 12);
  });

  test("is the cone edge as a fraction of half the short side, beyond it when the fov is capped, and none at 90°", () => {
    const rad = Math.PI / 180;
    expect(coneCircleRadius(10)).toBeCloseTo(Math.tan(10 * rad) / Math.tan(10.5 * rad), 12);
    expect(coneCircleRadius(14.38)).toBeLessThan(1);
    expect(coneCircleRadius(60)).toBeCloseTo(1, 12); // fov ด้านสั้น 120° พอดี
    expect(coneCircleRadius(75)).toBeCloseTo(Math.tan(75 * rad) / Math.tan(60 * rad), 12);
    expect(coneCircleRadius(90)).toBeNull();
  });
});

describe("ground width text and the finest-level decision", () => {
  test("km above 1 km (digits by magnitude), whole metres below", () => {
    expect(groundWidthText(16_923_000)).toEqual({ unit: "km", width: "16923" });
    expect(groundWidthText(99_960)).toEqual({ unit: "km", width: "100" });
    expect(groundWidthText(10_409)).toEqual({ unit: "km", width: "10.4" });
    expect(groundWidthText(1_301)).toEqual({ unit: "km", width: "1.30" });
    expect(groundWidthText(1_000)).toEqual({ unit: "km", width: "1.00" });
    expect(groundWidthText(999.6)).toEqual({ unit: "km", width: "1.00" }); // ปัดเป็น 1000 m แล้วเป็น 1 km ไม่ใช่ "1000 m"
    expect(groundWidthText(999.4)).toEqual({ unit: "m", width: "999" });
    expect(groundWidthText(279.3)).toEqual({ unit: "m", width: "279" });
    expect(groundWidthText(0)).toEqual({ unit: "m", width: "0" });
  });

  test("the note needs a GIBS/EOX/OSM layer more than one level below the needed level (Cesium already settles for about 2 px per texel)", () => {
    const l = (source: "gibs" | "eox" | "osm" | "ion", maxLevel: number | null) => ({ title: "L", label: "", missing: false, source, maxLevel });
    expect(finestLevelReached(l("gibs", 9), 14)).toBe(true);
    expect(finestLevelReached(l("gibs", 9), 11)).toBe(true);
    expect(finestLevelReached(l("gibs", 9), 10)).toBe(false); // ต้องการ 10 แต่ Cesium เองก็ใช้ระดับ 9 (≈ 2 px ต่อ texel) ภาพยังเท่าเดิม
    expect(finestLevelReached(l("gibs", 9), 9)).toBe(false);
    expect(finestLevelReached(l("gibs", 9), 3)).toBe(false);
    expect(finestLevelReached(l("eox", 15), 17)).toBe(true);
    expect(finestLevelReached(l("eox", 15), 16)).toBe(false);
    expect(finestLevelReached(l("osm", 19), 21)).toBe(true);
    expect(finestLevelReached(l("osm", 19), 20)).toBe(false);
    expect(finestLevelReached(l("ion", 12), 20)).toBe(false);
    expect(finestLevelReached(l("ion", null), 20)).toBe(false);
    expect(finestLevelReached(l("gibs", null), 20)).toBe(false);
    expect(finestLevelReached(null, 20)).toBe(false);
    expect(finestLevelReached(l("gibs", 9), null)).toBe(false);
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

// ข2 final minor: ทางของดาว (sensor ตัวแรกหรือสร้าง Sensor<n>) เป็นของคำสั่ง Sensor View เท่านั้น Show Imagery ไม่ใช้ (amendment z) จึงไม่ export
test("the satellite branch of the Sensor View command is internal to SensorView/commands.ts", async () => {
  const commands = await import("../../src/windows/SensorView/commands");
  expect(Object.keys(commands)).not.toContain("openSensorViewForSatellite");
  const source = readFileSync(resolve(import.meta.dirname, "../../src/windows/SensorView/commands.ts"), "utf8");
  // doc comment ของมันอ้าง amendment z (Ruling n ใช้กับ firstSensorOf ของ Show Imagery เท่านั้น)
  const doc = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*async function openSensorViewForSatellite\b/.exec(source)?.[1] ?? "";
  expect(doc).toContain("amendment z");
  expect(doc).not.toMatch(/Ruling n\b/);
});
