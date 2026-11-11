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
import { useTime } from "../../src/stores/time";
import { registerGraphics3DCommands } from "../../src/windows/Graphics3D/commands3d";
import { Graphics3D } from "../../src/windows/Graphics3D/Graphics3D";
import { activeScene, notifyScenes, resetScenes, type MouseMode, type Scene3DHandle } from "../../src/windows/Graphics3D/registry";
import { mountScene3D } from "../../src/windows/Graphics3D/scene3d";
import { WindowProperties3D } from "../../src/windows/Graphics3D/WindowProperties3D";
import { ViewFromTo } from "../../src/windows/ViewFromTo/ViewFromTo";
import { makeDoc, openScenario, resetWithCoreCommands } from "./helpers/chrome";
import { stubFetch } from "./helpers/fake-fetch";

vi.mock("../../src/windows/Graphics3D/scene3d", () => ({ mountScene3D: vi.fn() }));

type Fake = Scene3DHandle & { calls: unknown[][]; setFailed(v: boolean): void };
function fakeScene(panelId: string): Fake {
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
    zoomTo: () => true,
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
    expect(screen.getByRole("status").textContent).toBe(msg("banner.sceneFailed"));
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
      expect(names(t("toolbar.window3dDefaults"))).toEqual(["Properties", "Grab Globe", "Zoom In"]);
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
    });
    expect(closePanel).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "Annotation" }));
    await user.click(screen.getByLabelText("Show Time"));
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(useLayout.getState().windowProps.graphics3d?.showTime).toBe(false);
    expect(closePanel).toHaveBeenCalledWith("windowProperties3d");
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
