// หน้าต่าง 2D ส่วน React (Graphics2D, 2D Graphics Window Properties, คำสั่ง g2d.*) โดยไม่วาด Cesium:
// การสร้างภาพ (scene2d.mountScene2D) ถูกแทนด้วยตัวปลอม และ jsdom ไม่มี WebGL เว้นแต่ test ใส่ WebGLRenderingContext ให้

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installTestHooks } from "../../src/cesium/testHooks";
import { isEnabled, runCommand } from "../../src/commands";
import { t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { useJobs } from "../../src/stores/jobs";
import { useLayout } from "../../src/stores/layout";
import { useMessages } from "../../src/stores/messages";
import { useResults, type ResultsInfo } from "../../src/stores/results";
import { useTime } from "../../src/stores/time";
import { registerGraphics2DCommands } from "../../src/windows/Graphics2D/commands2d";
import { Graphics2D } from "../../src/windows/Graphics2D/Graphics2D";
import { DEFAULT_PROPS_2D, props2d } from "../../src/windows/Graphics2D/props2d";
import { activeScene2D, notifyScenes2D, registerScene2D, resetScenes2D, type Scene2DHandle } from "../../src/windows/Graphics2D/registry2d";
import { mountScene2D } from "../../src/windows/Graphics2D/scene2d";
import { WindowProperties2D } from "../../src/windows/Graphics2D/WindowProperties2D";
import type { MouseMode } from "../../src/windows/graphics/sceneRegistry";
import { makeDoc, openScenario, resetWithCoreCommands } from "./helpers/chrome";
import { stubFetch } from "./helpers/fake-fetch";

vi.mock("../../src/windows/Graphics2D/scene2d", () => ({ mountScene2D: vi.fn() }));

type Fake = Scene2DHandle & { calls: unknown[][]; setFailed(v: boolean): void };
function fakeScene(panelId: string, view: [number, number, number, number] | null = null): Fake {
  const calls: unknown[][] = [];
  let mode: MouseMode = "grab";
  let failed = false;
  return {
    panelId,
    calls,
    sceneFailed: () => failed,
    setFailed: (v) => {
      failed = v;
      notifyScenes2D();
    },
    mouseMode: () => mode,
    setMouseMode: (m) => {
      mode = m;
      calls.push(["setMouseMode", m]);
      notifyScenes2D();
    },
    zoomOut: () => void calls.push(["zoomOut"]),
    resize: () => void calls.push(["resize"]),
    destroy: () => void calls.push(["destroy"]),
    viewRectangle: () => view,
    overlayCounts: () => ({}),
    sensorFootprintPoints: () => null,
  };
}

const info = (status: "current" | "stale" | "missing"): ResultsInfo => ({
  ephem: { hash: status === "missing" ? null : "abc", status, available: [] },
  access: {},
  error: null,
});

let disposeCore: () => void;
let disposeG2d: () => void;
beforeEach(() => {
  disposeCore = resetWithCoreCommands();
  disposeG2d = registerGraphics2DCommands();
  resetScenes2D();
  vi.mocked(mountScene2D).mockReset();
});
afterEach(() => {
  cleanup();
  disposeG2d();
  disposeCore();
  resetScenes2D();
  vi.unstubAllGlobals();
});

const withWebGL = (): void => {
  vi.stubGlobal("WebGLRenderingContext", function WebGLRenderingContext() {});
};

describe("Graphics2D", () => {
  test("without WebGL it shows the Thai message instead of a map and never loads Cesium", async () => {
    render(<Graphics2D panelId="graphics2d" params={{ n: 1 }} />);
    expect((await screen.findByRole("alert")).textContent).toBe(msg("webgl.unsupported"));
    expect(mountScene2D).not.toHaveBeenCalled();
    expect(activeScene2D()).toBeUndefined();
  });

  test("with WebGL the window mounts its map with the stored projection, registers it and destroys it on unmount", async () => {
    withWebGL();
    const scene = fakeScene("graphics2d");
    vi.mocked(mountScene2D).mockReturnValue(scene);
    useLayout.getState().setWindowProps("graphics2d", { projection: "mercator" });
    const { unmount } = render(<Graphics2D panelId="graphics2d" params={{ n: 1 }} />);
    await waitFor(() => expect(activeScene2D()).toBe(scene));
    const [id, el, opts] = vi.mocked(mountScene2D).mock.calls[0];
    expect(id).toBe("graphics2d");
    expect(el).toBe(screen.getByTestId("g2d-view"));
    expect(opts).toEqual({ projection: "mercator", view: null });
    unmount();
    expect(scene.calls).toContainEqual(["destroy"]);
    expect(activeScene2D()).toBeUndefined();
  });

  test("a new projection rebuilds the map and keeps the area that was in view", async () => {
    withWebGL();
    const first = fakeScene("graphics2d", [90, 0, 120, 30]);
    const second = fakeScene("graphics2d");
    vi.mocked(mountScene2D).mockReturnValueOnce(first).mockReturnValueOnce(second);
    render(<Graphics2D panelId="graphics2d" params={{ n: 1 }} />);
    await waitFor(() => expect(activeScene2D()).toBe(first));
    act(() => useLayout.getState().setWindowProps("graphics2d", { ...DEFAULT_PROPS_2D, projection: "mercator" }));
    await waitFor(() => expect(activeScene2D()).toBe(second));
    expect(first.calls).toContainEqual(["destroy"]);
    expect(vi.mocked(mountScene2D).mock.calls[1][2]).toEqual({ projection: "mercator", view: [90, 0, 120, 30] });
    // ค่าอื่นของหน้าต่าง (เช่น Lat/Lon Lines) ไม่สร้างภาพใหม่
    act(() => useLayout.getState().setWindowProps("graphics2d", { ...DEFAULT_PROPS_2D, projection: "mercator", latLonLines: false }));
    expect(mountScene2D).toHaveBeenCalledTimes(2);
  });

  test("a map whose picture stops (render error or lost WebGL context) shows the Thai message and logs it", async () => {
    withWebGL();
    vi.mocked(mountScene2D).mockReturnValue(fakeScene("graphics2d"));
    render(<Graphics2D panelId="graphics2d" params={{ n: 1 }} />);
    await waitFor(() => expect(activeScene2D()).toBeDefined());
    const stopped = vi.mocked(mountScene2D).mock.calls[0][3] as (reason: string, error?: unknown) => void;
    act(() => stopped("contextLost"));
    expect((await screen.findByRole("alert")).textContent).toBe(msg("scene.renderStopped"));
    const logged = useMessages.getState().items.at(-1);
    expect(logged?.code).toBe("SCENE_RENDER");
    expect(logged?.text).toBe(msg("scene.renderStoppedLog", { window: "2D", message: "WebGL context lost" }));
  });

  test("a map that cannot start (WebGL blocked) gets the same message", async () => {
    withWebGL();
    vi.mocked(mountScene2D).mockImplementation(() => {
      throw new Error("WebGL initialization failed");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<Graphics2D panelId="graphics2d" params={{ n: 1 }} />);
    expect((await screen.findByRole("alert")).textContent).toBe(msg("webgl.unsupported"));
    expect(activeScene2D()).toBeUndefined();
    error.mockRestore();
  });

  test("stale results show the same banner as 3D, and Apply queues propagate", async () => {
    const user = userEvent.setup();
    openScenario(makeDoc({ name: "T" }));
    const f = stubFetch({ "POST /api/scenarios/T/propagate": { status: 202, json: { job: "j-20261112T000000-abcd" } } });
    useResults.setState({ status: "stale", info: info("stale") });
    render(<Graphics2D panelId="graphics2d" params={{ n: 1 }} />);
    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain(msg("banner.stale"));
    await user.click(within(banner).getByRole("button", { name: t("dialog.apply") }));
    expect(f.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/scenarios/T/propagate"]);
    expect(useJobs.getState().jobs["j-20261112T000000-abcd"]).toMatchObject({ kind: "propagate", scenario: "T", state: "queued" });
  });

  test("a scene that failed to load says so for the 2D window until a retry loads it", async () => {
    withWebGL();
    const scene = fakeScene("graphics2d");
    vi.mocked(mountScene2D).mockReturnValue(scene);
    openScenario();
    useResults.setState({ status: "current", info: info("current") });
    render(<Graphics2D panelId="graphics2d" params={{ n: 1 }} />);
    await waitFor(() => expect(activeScene2D()).toBe(scene));
    expect(screen.queryByRole("status")).toBeNull();
    act(() => scene.setFailed(true));
    expect(screen.getByRole("status").textContent).toBe(msg("banner.sceneFailed", { window: "2D" }));
    act(() => scene.setFailed(false));
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("Shift + wheel steps the time on the 2D map as well", () => {
    openScenario();
    useTime.getState().setCurrent(new Date("2026-11-12T06:00:00Z"));
    render(<Graphics2D panelId="graphics2d" params={{ n: 1 }} />);
    const t0 = useTime.getState().current.getTime();
    fireEvent(screen.getByTestId("g2d-view"), new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -120, shiftKey: true }));
    expect(useTime.getState().current.getTime()).toBe(t0 + 60_000);
  });

  test("panel resizes reach the map", async () => {
    withWebGL();
    const scene = fakeScene("graphics2d");
    vi.mocked(mountScene2D).mockReturnValue(scene);
    let resized: ((size: { width: number; height: number }) => void) | null = null;
    useLayout.setState({ onPanelResize: (_id: string, cb: (size: { width: number; height: number }) => void) => ((resized = cb), () => undefined) } as never);
    render(<Graphics2D panelId="graphics2d" params={{ n: 1 }} />);
    await waitFor(() => expect(activeScene2D()).toBe(scene));
    act(() => resized?.({ width: 300, height: 200 }));
    expect(scene.calls).toContainEqual(["resize"]);
  });
});

describe("2D Window Defaults", () => {
  test("the toolbar is on the 2D window when chosen in View → Toolbars: Properties, Zoom In (a mode) and Zoom Out", async () => {
    withWebGL();
    const scene = fakeScene("graphics2d");
    vi.mocked(mountScene2D).mockReturnValue(scene);
    render(<Graphics2D panelId="graphics2d" params={{ n: 1 }} />);
    await waitFor(() => expect(activeScene2D()).toBe(scene));
    expect(screen.queryByRole("toolbar")).toBeNull(); // ตั้งต้นซ่อน (spec §4.2)
    act(() => useLayout.getState().setToolbar("defaults2d", true));
    const bar = screen.getByRole("toolbar", { name: t("toolbar.window2dDefaults") });
    expect(within(bar).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Properties", "Zoom In", "Zoom Out"]);
    expect(within(bar).getByRole("button", { name: "Zoom In" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(within(bar).getByRole("button", { name: "Zoom In" }));
    expect(scene.mouseMode()).toBe("zoomIn");
    expect(within(bar).getByRole("button", { name: "Zoom In" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(bar).getByRole("button", { name: "Zoom Out" }));
    expect(scene.calls).toContainEqual(["zoomOut"]);
  });

  test("the g2d commands work on the active 2D window and are disabled while no 2D window is open", async () => {
    expect(isEnabled("g2d.properties")).toBe(false);
    expect(isEnabled("g2d.zoomIn")).toBe(false);
    expect(isEnabled("g2d.zoomOut")).toBe(false);
    withWebGL();
    const scene = fakeScene("graphics2d-2");
    vi.mocked(mountScene2D).mockReturnValue(scene);
    const openPanel = vi.fn(() => "windowProperties2d");
    useLayout.setState({ openPanel } as never);
    const { unmount } = render(<Graphics2D panelId="graphics2d-2" params={{ n: 2 }} />);
    await waitFor(() => expect(isEnabled("g2d.properties")).toBe(true));
    runCommand("g2d.properties");
    expect(openPanel).toHaveBeenCalledWith("windowProperties2d", { target: "graphics2d-2" });
    runCommand("g2d.zoomIn");
    expect(scene.mouseMode()).toBe("zoomIn");
    runCommand("g2d.zoomOut");
    expect(scene.calls).toContainEqual(["zoomOut"]);
    unmount();
    expect(isEnabled("g2d.zoomOut")).toBe(false);
  });
});

describe("2D Graphics Window Properties values", () => {
  test("missing or broken values fall back to the defaults", () => {
    expect(props2d(undefined)).toEqual(DEFAULT_PROPS_2D);
    expect(props2d({ projection: "Robinson", latLonLines: "yes", showIpp: 1 })).toEqual(DEFAULT_PROPS_2D);
    expect(DEFAULT_PROPS_2D).toEqual({ projection: "equidistantCylindrical", latLonLines: true, showIpp: false, showOutline: false, shading: false });
  });

  test("stored values are used as they are", () => {
    const p = { projection: "mercator", latLonLines: false, showIpp: true, showOutline: true, shading: true };
    expect(props2d(p)).toEqual(p);
  });
});

describe("2D Graphics Window Properties", () => {
  const fakeApi = (open: string[]) => ({ getPanel: (id: string) => (open.includes(id) ? { id } : undefined) });

  test("Projection, Details and Lighting pages; Apply stores the settings of the target 2D window, OK applies and closes", async () => {
    const user = userEvent.setup();
    const closePanel = vi.fn();
    useLayout.setState({ api: fakeApi(["graphics2d"]) as never, closePanel } as never);
    render(<WindowProperties2D panelId="windowProperties2d" params={{ target: "graphics2d" }} />);
    expect(screen.getAllByRole("tab").map((b) => b.textContent)).toEqual(["Projection", "Details", "Lighting"]);
    const projection = screen.getByRole("combobox", { name: "Projection" }) as HTMLSelectElement;
    expect([...projection.options].map((o) => o.textContent)).toEqual(["Equidistant Cylindrical", "Mercator"]);
    await user.selectOptions(projection, "mercator");
    const frame = screen.getByLabelText("Display Coordinate Frame") as HTMLSelectElement;
    expect([...frame.options].map((o) => o.textContent)).toEqual(["ECF"]);
    expect(screen.getByText(msg("g2d.coordFrameNote"))).toBeDefined();
    await user.click(screen.getByRole("tab", { name: "Details" }));
    expect((screen.getByLabelText("Lat/Lon Lines") as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByLabelText("Show IPP"));
    expect(screen.getByText(msg("g2d.ippNote"))).toBeDefined();
    await user.click(screen.getByRole("tab", { name: "Lighting" }));
    await user.click(screen.getByLabelText("Show Outline"));
    expect(screen.getByText(msg("g2d.lightingNote"))).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(useLayout.getState().windowProps.graphics2d).toEqual({ projection: "mercator", latLonLines: true, showIpp: true, showOutline: true, shading: false });
    expect(closePanel).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText("Shading"));
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(useLayout.getState().windowProps.graphics2d?.shading).toBe(true);
    expect(closePanel).toHaveBeenCalledWith("windowProperties2d");
  });

  test("shows the stored settings; Apply waits for a change and Cancel closes without storing", async () => {
    const user = userEvent.setup();
    const closePanel = vi.fn();
    useLayout.setState({ api: fakeApi(["graphics2d-2"]) as never, closePanel, windowProps: { "graphics2d-2": { projection: "mercator", shading: true } } } as never);
    render(<WindowProperties2D panelId="windowProperties2d" params={{ target: "graphics2d-2" }} />);
    expect((screen.getByRole("combobox", { name: "Projection" }) as HTMLSelectElement).value).toBe("mercator");
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("tab", { name: "Lighting" }));
    expect((screen.getByLabelText("Shading") as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByLabelText("Shading"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(closePanel).toHaveBeenCalledWith("windowProperties2d");
    expect(useLayout.getState().windowProps["graphics2d-2"]).toEqual({ projection: "mercator", shading: true });
  });

  test("a closed target window is explained and nothing can be applied", () => {
    useLayout.setState({ api: fakeApi([]) as never });
    render(<WindowProperties2D panelId="windowProperties2d" params={{ target: "graphics2d-9" }} />);
    expect(screen.getByRole("alert").textContent).toBe(msg("g2d.noWindow"));
    expect((screen.getByRole("button", { name: "OK" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("window.__gnssStudioTest for the 2D window", () => {
  afterEach(() => {
    delete window.__gnssStudioTest;
  });

  test("overlays2d reports what the first 2D window draws, null without one", () => {
    installTestHooks();
    expect(window.__gnssStudioTest!.overlays2d()).toBeNull();
    registerScene2D({ ...fakeScene("graphics2d-2"), overlayCounts: () => ({ swath: 2 }) });
    registerScene2D({ ...fakeScene("graphics2d"), overlayCounts: () => ({ swath: 1, ipp: 30 }) });
    expect(window.__gnssStudioTest!.overlays2d()).toEqual({ swath: 1, ipp: 30 });
  });
});
