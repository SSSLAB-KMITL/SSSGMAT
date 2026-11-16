// หน้าต่าง 3D ส่วน React (Graphics3D, 3D Graphics Window Properties, View From/To) โดยไม่วาด Cesium:
// การสร้าง viewer (scene3d.mountScene3D) ถูกแทนด้วยตัวปลอม และ jsdom ไม่มี WebGL เว้นแต่ test ใส่ WebGLRenderingContext ให้

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { useJobs } from "../../src/stores/jobs";
import { useLayout } from "../../src/stores/layout";
import { useMessages } from "../../src/stores/messages";
import { useResults, type ResultsInfo } from "../../src/stores/results";
import { useSelection } from "../../src/stores/selection";
import { useTime } from "../../src/stores/time";
import { registerGraphics3DCommands } from "../../src/windows/Graphics3D/commands3d";
import { Graphics3D } from "../../src/windows/Graphics3D/Graphics3D";
import { activeScene, notifyScenes, resetScenes, type MouseMode, type Scene3DHandle } from "../../src/windows/Graphics3D/registry";
import { props3d } from "../../src/windows/Graphics3D/props";
import { mountScene3D } from "../../src/windows/Graphics3D/scene3d";
import { WindowProperties3D } from "../../src/windows/Graphics3D/WindowProperties3D";
import { ViewFromTo } from "../../src/windows/ViewFromTo/ViewFromTo";
import { makeDoc, openScenario, resetWithCoreCommands } from "./helpers/chrome";
import { stubFetch } from "./helpers/fake-fetch";
import { loadObjects, satPath } from "./helpers/objects";

vi.mock("../../src/windows/Graphics3D/scene3d", () => ({ mountScene3D: vi.fn() }));

type Fake = Scene3DHandle & { calls: unknown[][]; setFailed(v: boolean): void };
function fakeScene(panelId: string, over: Partial<Scene3DHandle> = {}): Fake {
  const calls: unknown[][] = [];
  let mode: MouseMode = "grab";
  let failed = false;
  return {
    panelId,
    calls,
    sceneFailed: () => failed,
    setFailed: (v) => {
      failed = v;
      notifyScenes(); // เหมือนของจริง (SceneSource.changed)
    },
    homeView: () => void calls.push(["homeView"]),
    zoomTo: (path) => {
      calls.push(["zoomTo", path]);
      return true;
    },
    viewFromTo: (req) => {
      calls.push(["viewFromTo", req]);
      return "ok";
    },
    mouseMode: () => mode,
    setMouseMode: (m) => {
      mode = m;
      notifyScenes(); // เหมือนของจริง: ปุ่มที่กดค้างวาดใหม่
    },
    resize: () => void calls.push(["resize"]),
    destroy: () => void calls.push(["destroy"]),
    entityPositionEcef: () => null,
    entityColor: () => null,
    labelShown: () => null,
    frameCount: () => 0,
    loadedAt: () => null,
    sensorFootprintPoints: () => null,
    modelCount: () => 0,
    satelliteOrientation: () => null,
    pointShown: () => null,
    satelliteModel: () => null,
    flyToSatellite: () => false,
    pathAt: () => null,
    entityScreenPosition: () => null,
    ...over,
  };
}

const info = (status: "current" | "stale" | "missing", error: ResultsInfo["error"] = null): ResultsInfo => ({
  ephem: { hash: status === "missing" ? null : "abc", status, available: status === "missing" ? [] : ["abc"] },
  access: {},
  error,
});

let disposeCore: () => void;
let disposeG3d: () => void;
beforeEach(() => {
  disposeCore = resetWithCoreCommands();
  disposeG3d = registerGraphics3DCommands();
  resetScenes();
  vi.mocked(mountScene3D).mockReset();
});
afterEach(() => {
  cleanup();
  disposeG3d();
  disposeCore();
  resetScenes();
  vi.unstubAllGlobals();
});

const withWebGL = (): void => {
  vi.stubGlobal("WebGLRenderingContext", function WebGLRenderingContext() {});
};

describe("Graphics3D", () => {
  test("without WebGL it shows the Thai message instead of a picture and never loads Cesium", async () => {
    render(<Graphics3D panelId="graphics3d" params={{ n: 1 }} />);
    expect((await screen.findByRole("alert")).textContent).toBe(msg("webgl.unsupported"));
    expect(mountScene3D).not.toHaveBeenCalled();
    expect(activeScene()).toBeUndefined();
  });

  test("a viewer that cannot start (WebGL blocked) gets the same message, and Cesium's own error box is cleared", async () => {
    withWebGL();
    vi.mocked(mountScene3D).mockImplementation((_id, el) => {
      el.innerHTML = "<div class='cesium-widget-errorPanel'>Error constructing CesiumWidget.</div>";
      throw new Error("WebGL initialization failed");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<Graphics3D panelId="graphics3d" params={{ n: 1 }} />);
    expect((await screen.findByRole("alert")).textContent).toBe(msg("webgl.unsupported"));
    expect(screen.getByTestId("g3d-view").childElementCount).toBe(0);
    expect(activeScene()).toBeUndefined();
    error.mockRestore();
  });

  test("with WebGL the window registers its scene and destroys it on unmount", async () => {
    withWebGL();
    const scene = fakeScene("graphics3d");
    vi.mocked(mountScene3D).mockReturnValue(scene);
    const { unmount } = render(<Graphics3D panelId="graphics3d" params={{ n: 1 }} />);
    await waitFor(() => expect(activeScene()).toBe(scene));
    expect(vi.mocked(mountScene3D).mock.calls[0][0]).toBe("graphics3d");
    expect(vi.mocked(mountScene3D).mock.calls[0][1]).toBe(screen.getByTestId("g3d-view"));
    expect(screen.queryByRole("alert")).toBeNull();
    unmount();
    expect(scene.calls).toContainEqual(["destroy"]);
    expect(activeScene()).toBeUndefined();
  });

  describe("when the picture stops (render error or lost WebGL context)", () => {
    /** the callback Graphics3D hands to mountScene3D for a stopped picture */
    const stoppedCallback = () => vi.mocked(mountScene3D).mock.calls[0][2] as (reason: string, error?: unknown) => void;

    test("a render error shows the Thai message in the window and logs it in the Message Viewer", async () => {
      withWebGL();
      vi.mocked(mountScene3D).mockReturnValue(fakeScene("graphics3d"));
      render(<Graphics3D panelId="graphics3d" params={{ n: 1 }} />);
      await waitFor(() => expect(activeScene()).toBeDefined());
      expect(screen.queryByRole("alert")).toBeNull();
      act(() => stoppedCallback()("renderError", new Error("shader failed")));
      expect((await screen.findByRole("alert")).textContent).toBe(msg("scene.renderStopped"));
      const logged = useMessages.getState().items.at(-1);
      expect(logged?.code).toBe("SCENE_RENDER");
      expect(logged?.level).toBe("error");
      expect(logged?.text).toBe(msg("scene.renderStoppedLog", { window: "3D", message: "shader failed" }));
    });

    test("a lost WebGL context does the same", async () => {
      withWebGL();
      vi.mocked(mountScene3D).mockReturnValue(fakeScene("graphics3d"));
      render(<Graphics3D panelId="graphics3d" params={{ n: 1 }} />);
      await waitFor(() => expect(activeScene()).toBeDefined());
      act(() => stoppedCallback()("contextLost"));
      expect((await screen.findByRole("alert")).textContent).toBe(msg("scene.renderStopped"));
      expect(useMessages.getState().items.at(-1)?.code).toBe("SCENE_RENDER");
    });

    test("nothing is shown or logged for a window that is already closed", async () => {
      withWebGL();
      vi.mocked(mountScene3D).mockReturnValue(fakeScene("graphics3d"));
      const { unmount } = render(<Graphics3D panelId="graphics3d" params={{ n: 1 }} />);
      await waitFor(() => expect(activeScene()).toBeDefined());
      const stopped = stoppedCallback();
      unmount();
      const before = useMessages.getState().items.length;
      act(() => stopped("contextLost"));
      expect(useMessages.getState().items).toHaveLength(before);
    });
  });

  describe("results banner", () => {
    test("stale results: the agreed Thai line and Apply, which queues propagate for this scenario", async () => {
      const user = userEvent.setup();
      openScenario(makeDoc({ name: "T" }));
      const f = stubFetch({ "POST /api/scenarios/T/propagate": { status: 202, json: { job: "j-20261112T000000-abcd" } } });
      useResults.setState({ status: "stale", info: info("stale") });
      render(<Graphics3D panelId="graphics3d" params={{ n: 1 }} />);
      const banner = screen.getByRole("status");
      expect(banner.textContent).toContain("ผลลัพธ์ไม่ตรงกับ scenario ปัจจุบัน — กด Apply เพื่อคำนวณใหม่");
      await user.click(within(banner).getByRole("button", { name: t("dialog.apply") }));
      expect(f.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/scenarios/T/propagate"]);
      expect(useJobs.getState().jobs["j-20261112T000000-abcd"]).toMatchObject({ kind: "propagate", scenario: "T", state: "queued" });
      // งานค้างอยู่: ปุ่มกดไม่ได้และบอกว่ากำลังคำนวณ
      const apply = within(screen.getByRole("status")).getByRole("button", { name: t("dialog.apply") }) as HTMLButtonElement;
      expect(apply.disabled).toBe(true);
      expect(screen.getByRole("status").textContent).toContain(msg("banner.running"));
      act(() => useJobs.getState().onJobEvent({ id: "j-20261112T000000-abcd", kind: "propagate", scenario: "T", state: "succeeded", progress: { stage: null, fraction: 1 } }));
      expect(apply.disabled).toBe(false);
    });

    test("missing results say so; the results error from the server is shown too", () => {
      openScenario();
      useResults.setState({ status: "missing", info: info("missing", { code: "SNAPSHOT_MISSING", text: "ไม่พบ snapshot" }) });
      render(<Graphics3D panelId="graphics3d" params={{ n: 1 }} />);
      expect(screen.getByRole("status").textContent).toContain(msg("banner.missing"));
      expect(screen.getByRole("status").textContent).toContain("ไม่พบ snapshot");
    });

    test("no banner with current results, unknown status or no scenario", () => {
      useResults.setState({ status: "stale", info: info("stale") });
      const { rerender } = render(<Graphics3D panelId="graphics3d" params={{ n: 1 }} />);
      expect(screen.queryByRole("status")).toBeNull(); // ไม่มี scenario
      openScenario();
      act(() => useResults.setState({ status: "current", info: info("current") }));
      rerender(<Graphics3D panelId="graphics3d" params={{ n: 1 }} />);
      expect(screen.queryByRole("status")).toBeNull();
      act(() => useResults.setState({ status: "unknown", info: null }));
      expect(screen.queryByRole("status")).toBeNull();
    });

    test("a failed Apply is reported in Thai in the Message Viewer", async () => {
      const user = userEvent.setup();
      openScenario(makeDoc({ name: "T" }));
      stubFetch({ "POST /api/scenarios/T/propagate": { status: 409, json: { code: "BUSY", text: "มีงานอยู่แล้ว" } } });
      useResults.setState({ status: "stale", info: info("stale") });
      render(<Graphics3D panelId="graphics3d" params={{ n: 1 }} />);
      await user.click(screen.getByRole("button", { name: t("dialog.apply") }));
      await waitFor(() => expect(useMessages.getState().items.at(-1)?.text).toBe(msg("banner.applyFailed", { message: "มีงานอยู่แล้ว" })));
      expect((screen.getByRole("button", { name: t("dialog.apply") }) as HTMLButtonElement).disabled).toBe(false);
    });
  });

  test("a scene that failed to load says so in Thai over the picture until a retry loads it", async () => {
    withWebGL();
    const scene = fakeScene("graphics3d");
    vi.mocked(mountScene3D).mockReturnValue(scene);
    openScenario();
    useResults.setState({ status: "current", info: info("current") });
    render(<Graphics3D panelId="graphics3d" params={{ n: 1 }} />);
    await waitFor(() => expect(activeScene()).toBe(scene));
    expect(screen.queryByRole("status")).toBeNull();
    act(() => scene.setFailed(true));
    expect(screen.getByRole("status").textContent).toBe(msg("banner.sceneFailed", { window: "3D" }));
    act(() => scene.setFailed(false));
    expect(screen.queryByRole("status")).toBeNull();
  });

  describe("Shift + mouse wheel", () => {
    const wheel = (init: WheelEventInit): WheelEvent => {
      const e = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
      fireEvent(screen.getByTestId("g3d-view"), e);
      return e;
    };

    test("steps the time one step: wheel up = Step Forward, wheel down = Step Backward", () => {
      openScenario();
      useTime.getState().setCurrent(new Date("2026-11-12T06:00:00Z")); // กลางช่วง: ถอยหลังไม่ถูก Loop พาไปปลายช่วง
      render(<Graphics3D panelId="graphics3d" params={{ n: 1 }} />);
      const t0 = useTime.getState().current.getTime();
      const up = wheel({ deltaY: -120, shiftKey: true });
      expect(up.defaultPrevented).toBe(true);
      expect(useTime.getState().current.getTime()).toBe(t0 + 60_000);
      wheel({ deltaY: 120, shiftKey: true });
      wheel({ deltaY: 120, shiftKey: true });
      expect(useTime.getState().current.getTime()).toBe(t0 - 60_000);
    });

    test("macOS turns Shift + wheel into a sideways scroll: deltaX counts when deltaY is 0", () => {
      openScenario();
      render(<Graphics3D panelId="graphics3d" params={{ n: 1 }} />);
      const t0 = useTime.getState().current.getTime();
      wheel({ deltaX: -40, deltaY: 0, shiftKey: true });
      expect(useTime.getState().current.getTime()).toBe(t0 + 60_000);
    });

    test("a plain wheel is left to Cesium's zoom and the time does not move", () => {
      openScenario();
      render(<Graphics3D panelId="graphics3d" params={{ n: 1 }} />);
      const t0 = useTime.getState().current.getTime();
      const e = wheel({ deltaY: -120 });
      expect(e.defaultPrevented).toBe(false);
      expect(useTime.getState().current.getTime()).toBe(t0);
    });

    test("does nothing without a scenario (the step commands are disabled)", () => {
      render(<Graphics3D panelId="graphics3d" params={{ n: 1 }} />);
      const t0 = useTime.getState().current.getTime();
      wheel({ deltaY: -120, shiftKey: true });
      expect(useTime.getState().current.getTime()).toBe(t0);
    });
  });

  describe("window toolbars and annotation", () => {
    test("3D Graphics and 3D Window Defaults appear on the window when chosen in View → Toolbars", async () => {
      withWebGL();
      const scene = fakeScene("graphics3d");
      vi.mocked(mountScene3D).mockReturnValue(scene);
      render(<Graphics3D panelId="graphics3d" params={{ n: 1 }} />);
      await waitFor(() => expect(activeScene()).toBe(scene));
      expect(screen.queryByRole("toolbar")).toBeNull(); // ตั้งต้นซ่อน (spec §4.2)
      act(() => {
        useLayout.getState().setToolbar("graphics3d", true);
        useLayout.getState().setToolbar("defaults3d", true);
      });
      const names = (bar: string) => within(screen.getByRole("toolbar", { name: bar })).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
      expect(names(t("toolbar.graphics3d"))).toEqual(["Home View", "View From/To"]);
      expect(names(t("toolbar.window3dDefaults"))).toEqual(["Properties", "Grab Globe", "Zoom In", "Show Orbits"]);
      const bar = screen.getByRole("toolbar", { name: t("toolbar.window3dDefaults") });
      expect(within(bar).getByRole("button", { name: "Grab Globe" }).getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(within(bar).getByRole("button", { name: "Zoom In" }));
      expect(scene.mouseMode()).toBe("zoomIn");
      expect(within(bar).getByRole("button", { name: "Zoom In" }).getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(within(screen.getByRole("toolbar", { name: t("toolbar.graphics3d") })).getByRole("button", { name: "Home View" }));
      expect(scene.calls).toContainEqual(["homeView"]);
    });

    test("Show Time puts the animation time on the picture in the scenario's DateFormat, and can be turned off", async () => {
      withWebGL();
      vi.mocked(mountScene3D).mockReturnValue(fakeScene("graphics3d"));
      openScenario();
      const { container } = render(<Graphics3D panelId="graphics3d" params={{ n: 1 }} />);
      await waitFor(() => expect(container.querySelector(".g3d-time")?.textContent).toBe("12 Nov 2026 00:00:00.000 UTCG"));
      act(() => useLayout.getState().setWindowProps("graphics3d", { showTime: false }));
      expect(container.querySelector(".g3d-time")).toBeNull();
    });

    test("panel resizes reach the viewer", async () => {
      withWebGL();
      const scene = fakeScene("graphics3d");
      vi.mocked(mountScene3D).mockReturnValue(scene);
      let resized: ((size: { width: number; height: number }) => void) | null = null;
      useLayout.setState({ onPanelResize: (_id: string, cb: (size: { width: number; height: number }) => void) => ((resized = cb), () => undefined) } as never);
      render(<Graphics3D panelId="graphics3d" params={{ n: 1 }} />);
      await waitFor(() => expect(activeScene()).toBe(scene));
      act(() => resized?.({ width: 300, height: 200 }));
      expect(scene.calls).toContainEqual(["resize"]);
    });
  });
});

describe("right-click menu on a satellite or a facility", () => {
  const G01 = satPath("G01");
  const THBK = "*/Facility/THBK";

  /** หน้าต่าง 3D ที่ pathAt ตอบตาม path (คืนตัวปลอมไว้ดู calls) */
  async function mountPicking(path: string | null): Promise<{ scene: Fake; pathAt: ReturnType<typeof vi.fn> }> {
    withWebGL();
    loadObjects();
    const pathAt = vi.fn((_x: number, _y: number): string | null => path);
    const scene = fakeScene("graphics3d", { pathAt });
    vi.mocked(mountScene3D).mockReturnValue(scene);
    render(<Graphics3D panelId="graphics3d" params={{ n: 1 }} />);
    await waitFor(() => expect(activeScene()).toBe(scene));
    return { scene, pathAt };
  }
  const menuTexts = async () => within(await screen.findByRole("menu")).getAllByRole("menuitem").map((m) => m.textContent);

  test("right-click on a satellite shows Properties, Sensor View, Zoom To, and selects the satellite first", async () => {
    const { pathAt } = await mountPicking(G01);
    const view = screen.getByTestId("g3d-view");
    vi.spyOn(view, "getBoundingClientRect").mockReturnValue({ left: 30, top: 20, x: 30, y: 20, width: 400, height: 300, right: 430, bottom: 320, toJSON: () => ({}) });
    fireEvent.contextMenu(view, { clientX: 120, clientY: 80 });
    expect(await menuTexts()).toEqual(["Properties", "Sensor View", "Zoom To"]);
    expect(pathAt).toHaveBeenCalledWith(90, 60); // พิกัดในภาพ ไม่ใช่ของหน้าจอ
    expect(useSelection.getState().activePath).toBe(G01); // คำสั่งในเมนูทำกับ object ที่ชี้
  });

  test("right-click on a facility shows Properties, Zoom To", async () => {
    await mountPicking(THBK);
    fireEvent.contextMenu(screen.getByTestId("g3d-view"), { clientX: 10, clientY: 10 });
    expect(await menuTexts()).toEqual(["Properties", "Zoom To"]);
    expect(useSelection.getState().activePath).toBe(THBK);
  });

  test("right-click on empty space shows no menu, keeps the selection and keeps the browser's own menu away", async () => {
    await mountPicking(null);
    useSelection.getState().select(G01);
    const notPrevented = fireEvent.contextMenu(screen.getByTestId("g3d-view"), { clientX: 10, clientY: 10 });
    expect(notPrevented).toBe(false); // preventDefault
    expect(screen.queryByRole("menu")).toBeNull();
    expect(useSelection.getState().activePath).toBe(G01);
  });

  test("a satellite's menu does not come back when the next right-click finds nothing", async () => {
    const { pathAt } = await mountPicking(G01);
    const view = screen.getByTestId("g3d-view");
    fireEvent.contextMenu(view, { clientX: 10, clientY: 10 });
    await menuTexts();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    pathAt.mockReturnValue(null);
    fireEvent.contextMenu(view, { clientX: 50, clientY: 50 });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  test("Zoom To in the menu zooms this window to the satellite that was pointed at", async () => {
    const { scene } = await mountPicking(G01);
    fireEvent.contextMenu(screen.getByTestId("g3d-view"), { clientX: 10, clientY: 10 });
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Zoom To" }));
    expect(scene.calls).toContainEqual(["zoomTo", G01]);
  });
});

describe("Show Orbits (task 13c)", () => {
  const fakeApi = (open: string[]) => ({ getPanel: (id: string) => (open.includes(id) ? { id } : undefined) });
  const shown = () => props3d(useLayout.getState().windowProps.graphics3d).showOrbits;
  /** คลิกขวาโดยไม่ลาก (กดและปล่อยปุ่มขวาที่จุดเดียวกัน) */
  const rightClick = (el: Element, x: number, y: number, upX = x, upY = y): void => {
    fireEvent.pointerDown(el, { button: 2, clientX: x, clientY: y });
    fireEvent.pointerUp(el, { button: 2, clientX: upX, clientY: upY });
  };

  async function mountWindow(pathAt: (x: number, y: number) => string | null = () => null): Promise<Fake> {
    withWebGL();
    loadObjects();
    const scene = fakeScene("graphics3d", { pathAt });
    vi.mocked(mountScene3D).mockReturnValue(scene);
    useLayout.setState({ windowProps: { graphics3d: { showTime: false } } });
    render(<Graphics3D panelId="graphics3d" params={{ n: 1 }} />);
    await waitFor(() => expect(activeScene()).toBe(scene));
    return scene;
  }

  test("the 3D Window Defaults button, the window's right-click menu and the Properties checkbox toggle the same window option", async () => {
    const user = userEvent.setup();
    await mountWindow();
    expect(shown()).toBe(true);

    // 1. ปุ่มบนแถบ 3D Window Defaults (ปุ่มแบบกดค้าง)
    act(() => useLayout.getState().setToolbar("defaults3d", true));
    const button = () => within(screen.getByRole("toolbar", { name: t("toolbar.window3dDefaults") })).getByRole("button", { name: "Show Orbits" });
    expect(button().getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button());
    expect(shown()).toBe(false);
    expect(button().getAttribute("aria-pressed")).toBe("false");
    expect(useLayout.getState().windowProps.graphics3d).toMatchObject({ showTime: false }); // ค่าอื่นของหน้าต่างคงเดิม

    // 2. เมนูคลิกขวาของหน้าต่าง (คลิกขวาที่ว่างโดยไม่ลาก)
    rightClick(screen.getByTestId("g3d-view"), 40, 30);
    const item = await screen.findByRole("menuitemcheckbox", { name: "Show Orbits" });
    expect(item.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(item);
    expect(shown()).toBe(true);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(button().getAttribute("aria-pressed")).toBe("true");

    // 3. ช่องใน 3D Graphics Window Properties → Details
    useLayout.setState({ api: fakeApi(["graphics3d"]) as never });
    render(<WindowProperties3D panelId="windowProperties3d" params={{ target: "graphics3d" }} />);
    await user.click(screen.getByRole("tab", { name: "Details" }));
    const box = screen.getByRole("checkbox", { name: "Show Orbits" }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    await user.click(box);
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(shown()).toBe(false);
    expect(button().getAttribute("aria-pressed")).toBe("false");
  });

  test("a right-drag (Cesium's zoom) opens no menu; a right-click on a satellite keeps its own menu", async () => {
    const pathAt = vi.fn((_x: number, _y: number): string | null => null);
    await mountWindow(pathAt);
    const view = screen.getByTestId("g3d-view");
    rightClick(view, 10, 10, 60, 60);
    expect(screen.queryByRole("menu")).toBeNull();
    pathAt.mockReturnValue(satPath("G01"));
    // ลำดับของ macOS: กดปุ่ม → contextmenu (เมนูของดาวเปิด) → ปล่อยปุ่ม
    fireEvent.pointerDown(view, { button: 2, clientX: 10, clientY: 10 });
    fireEvent.contextMenu(view, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(view, { button: 2, clientX: 10, clientY: 10 });
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByRole("menuitemcheckbox")).toBeNull(); // เมนูของดาว ไม่ใช่ของหน้าต่าง
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Properties", "Sensor View", "Zoom To"]);
  });
});

describe("3D Graphics Window Properties", () => {
  const fakeApi = (open: string[]) => ({ getPanel: (id: string) => (open.includes(id) ? { id } : undefined) });

  test("Apply stores the settings for the target 3D window; OK applies and closes", async () => {
    const user = userEvent.setup();
    const closePanel = vi.fn();
    useLayout.setState({ api: fakeApi(["graphics3d"]) as never, closePanel } as never);
    render(<WindowProperties3D panelId="windowProperties3d" params={{ target: "graphics3d" }} />);
    expect(screen.getAllByRole("tab").map((b) => b.textContent)).toEqual(["Lighting", "Details", "Annotation"]);
    await user.click(screen.getByLabelText("Enable Lighting"));
    const ambient = screen.getByLabelText("Ambient Level");
    await user.clear(ambient);
    await user.type(ambient, "20");
    expect(screen.getByText(msg("g3d.nightLightsNote"))).toBeDefined();
    await user.click(screen.getByRole("tab", { name: "Details" }));
    await user.click(screen.getByLabelText("Lat/Lon Lines"));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(useLayout.getState().windowProps.graphics3d).toEqual({
      enableLighting: true, ambientLevel: 20, sunLevel: 100, nightLightsLevel: 50, latLonLines: true, labelDeclutter: false, showTime: true,
      satelliteModels: true, modelPixelSize: 48, modelDetailThreshold: 30_000, showOrbits: true,
    });
    expect(closePanel).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "Annotation" }));
    await user.click(screen.getByLabelText("Show Time"));
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(useLayout.getState().windowProps.graphics3d?.showTime).toBe(false);
    expect(closePanel).toHaveBeenCalledWith("windowProperties3d");
  });

  test("Details: Satellite Models (on by default) and Model Pixel Size, a whole number of pixels from 16 to 256", async () => {
    const user = userEvent.setup();
    useLayout.setState({ api: fakeApi(["graphics3d"]) as never });
    render(<WindowProperties3D panelId="windowProperties3d" params={{ target: "graphics3d" }} />);
    await user.click(screen.getByRole("tab", { name: "Details" }));
    const models = screen.getByLabelText("Satellite Models") as HTMLInputElement;
    const size = screen.getByLabelText("Model Pixel Size") as HTMLInputElement;
    expect(models.checked).toBe(true);
    expect(size.value).toBe("48");
    for (const bad of ["300", "12.5"]) {
      await user.clear(size);
      await user.type(size, bad);
      await user.click(screen.getByRole("button", { name: "Apply" }));
      expect(size.getAttribute("aria-invalid"), bad).toBe("true");
      expect(useLayout.getState().windowProps.graphics3d).toBeUndefined();
    }
    expect(screen.getByRole("alert").textContent).toBe(msg("form.notInteger"));
    await user.clear(size);
    await user.type(size, "96");
    await user.click(models);
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(useLayout.getState().windowProps.graphics3d).toMatchObject({ satelliteModels: false, modelPixelSize: 96 });
  });

  test("Details: Model Detail Threshold (our label, km), a whole number from 1,000 to 200,000, default 30,000", async () => {
    const user = userEvent.setup();
    useLayout.setState({ api: fakeApi(["graphics3d"]) as never });
    render(<WindowProperties3D panelId="windowProperties3d" params={{ target: "graphics3d" }} />);
    await user.click(screen.getByRole("tab", { name: "Details" }));
    const threshold = screen.getByLabelText("Model Detail Threshold") as HTMLInputElement;
    expect(threshold.value).toBe("30000");
    expect(screen.getByText("km")).toBeDefined();
    for (const bad of ["999", "200001", "1500.5"]) {
      await user.clear(threshold);
      await user.type(threshold, bad);
      await user.click(screen.getByRole("button", { name: "Apply" }));
      expect(threshold.getAttribute("aria-invalid"), bad).toBe("true");
      expect(useLayout.getState().windowProps.graphics3d).toBeUndefined();
    }
    await user.clear(threshold);
    await user.type(threshold, "60000");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(useLayout.getState().windowProps.graphics3d).toMatchObject({ modelDetailThreshold: 60_000 });
  });

  test("a level outside 0–100 is refused at the field and nothing is stored", async () => {
    const user = userEvent.setup();
    useLayout.setState({ api: fakeApi(["graphics3d"]) as never });
    render(<WindowProperties3D panelId="windowProperties3d" params={{ target: "graphics3d" }} />);
    const sun = screen.getByLabelText("Sun Level");
    await user.clear(sun);
    await user.type(sun, "150");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(sun.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe(msg("props.rangeBetween", { min: 0, max: 100 }));
    expect(useLayout.getState().windowProps.graphics3d).toBeUndefined();
  });

  test("shows the stored settings of the window, and Cancel closes without storing", async () => {
    const user = userEvent.setup();
    const closePanel = vi.fn();
    useLayout.setState({ api: fakeApi(["graphics3d-2"]) as never, closePanel, windowProps: { "graphics3d-2": { sunLevel: 40, enableLighting: true } } } as never);
    render(<WindowProperties3D panelId="windowProperties3d" params={{ target: "graphics3d-2" }} />);
    expect((screen.getByLabelText("Sun Level") as HTMLInputElement).value).toBe("40");
    expect((screen.getByLabelText("Enable Lighting") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true); // ยังไม่ได้แก้
    await user.click(screen.getByLabelText("Enable Lighting"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(closePanel).toHaveBeenCalledWith("windowProperties3d");
    expect(useLayout.getState().windowProps["graphics3d-2"]).toEqual({ sunLevel: 40, enableLighting: true });
  });

  test("a closed target window is explained and nothing can be applied", () => {
    useLayout.setState({ api: fakeApi([]) as never });
    render(<WindowProperties3D panelId="windowProperties3d" params={{ target: "graphics3d-9" }} />);
    expect(screen.getByRole("alert").textContent).toBe(msg("g3d.noWindow"));
    expect((screen.getByRole("button", { name: "OK" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("View From/To", () => {
  const doc = () =>
    makeDoc({
      objects: [
        { class: "Facility", name: "THBK", position: { type: "Geodetic", lat_deg: 13.7, lon_deg: 100.8, alt_m: 6 } },
        { class: "Constellation", name: "GPS", assigned_objects: [] },
        { class: "Satellite", name: "G01", norad: 62339 },
        { class: "Satellite", name: "G02", norad: 62340 },
      ] as never,
    });

  test("From/To list the facilities and satellites; Apply points the target window's camera", async () => {
    const user = userEvent.setup();
    openScenario(doc());
    const scene = fakeScene("graphics3d-2");
    const { registerScene } = await import("../../src/windows/Graphics3D/registry");
    registerScene(fakeScene("graphics3d"));
    registerScene(scene);
    render(<ViewFromTo panelId="viewFromTo" params={{ target: "graphics3d-2" }} />);
    const from = screen.getByLabelText("From Position") as HTMLSelectElement;
    const to = screen.getByLabelText("To Position") as HTMLSelectElement;
    expect([...from.options].map((o) => o.textContent)).toEqual(["THBK", "G01", "G02"]);
    expect(from.value).toBe("*/Facility/THBK");
    expect(to.value).toBe("*/Satellite/G01");
    expect((screen.getByLabelText("Mode") as HTMLSelectElement).selectedOptions[0].textContent).toBe("From Position to Position");
    await user.selectOptions(to, "*/Satellite/G02");
    await user.selectOptions(screen.getByLabelText("Reference Frame"), "inertial");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(scene.calls).toEqual([["viewFromTo", { from: "*/Facility/THBK", to: "*/Satellite/G02", frame: "inertial" }]]);
  });

  test("the same object twice, or one the window cannot find, is explained in Thai", async () => {
    const user = userEvent.setup();
    openScenario(doc());
    const { registerScene } = await import("../../src/windows/Graphics3D/registry");
    registerScene({ ...fakeScene("graphics3d"), viewFromTo: () => "notFound" });
    render(<ViewFromTo panelId="viewFromTo" params={{ target: "graphics3d" }} />);
    await user.selectOptions(screen.getByLabelText("To Position"), "*/Facility/THBK");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert").textContent).toBe(msg("viewFromTo.same"));
    await user.selectOptions(screen.getByLabelText("To Position"), "*/Satellite/G01");
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.getByRole("alert").textContent).toBe(msg("viewFromTo.notFound"));
  });

  test("two copies of one satellite (one shared entity) count as the same object", async () => {
    const user = userEvent.setup();
    openScenario(doc());
    const { registerScene } = await import("../../src/windows/Graphics3D/registry");
    registerScene({ ...fakeScene("graphics3d"), viewFromTo: () => "same" });
    render(<ViewFromTo panelId="viewFromTo" params={{ target: "graphics3d" }} />);
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert").textContent).toBe(msg("viewFromTo.same"));
  });

  test("a closed target window is refused in Thai and no other 3D window is moved", async () => {
    const user = userEvent.setup();
    openScenario(doc());
    const { registerScene } = await import("../../src/windows/Graphics3D/registry");
    const other = fakeScene("graphics3d");
    registerScene(other);
    const closed = fakeScene("graphics3d-2");
    const unregister = registerScene(closed);
    render(<ViewFromTo panelId="viewFromTo" params={{ target: "graphics3d-2" }} />);
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => unregister());
    expect(screen.getByRole("alert").textContent).toBe(msg("g3d.noWindow"));
    expect((screen.getByRole("button", { name: "OK" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(other.calls).toEqual([]);
  });
});
