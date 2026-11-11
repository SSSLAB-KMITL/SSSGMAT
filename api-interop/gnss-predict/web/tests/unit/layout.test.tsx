import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DockviewApi } from "dockview-react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "../../src/api/client";
import { t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { getPanelDef, PANEL_KINDS, registerPanel, type PanelDef, type PanelKind } from "../../src/layout/panels";
import { WORKBOOK_MAX_BYTES, validateWorkbook, workbookBytes, type Workbook } from "../../src/layout/workbook";
import { useLayout, usePanelResize } from "../../src/stores/layout";
import { useMessages } from "../../src/stores/messages";
import { useScenario } from "../../src/stores/scenario";
import { Workspace } from "../../src/Workspace";
import { deferred, stubFetch } from "./helpers/fake-fetch";

const st = () => useLayout.getState();
const apiOf = (): DockviewApi => {
  const api = st().api;
  if (api === null) throw new Error("the workspace is not mounted");
  return api;
};

async function mount(props: { header?: React.ReactNode; footer?: React.ReactNode } = {}) {
  const view = render(<Workspace {...props} />);
  await waitFor(() => expect(st().api).not.toBeNull());
  return { ...view, api: apiOf() };
}

/**
 * กริดตรงกลางเป็นโครง: กลุ่ม = [panelId...] (ลำดับแท็บ); ช่องที่วางต่อกัน = {o: "H" (ข้างกัน) | "V" (ซ้อนกัน), c: [...]}
 * กริดว่าง = [] และ branch ที่มีลูกเดียวยุบเป็นลูกนั้น (dockview เก็บรากเป็น branch เสมอ)
 */
type Shape = string[] | { o: "H" | "V"; c: Shape[] };
function gridShape(api: DockviewApi): Shape {
  type Node = { type: "leaf"; data: { views: string[] } } | { type: "branch"; data: Node[] };
  const walk = (node: Node, o: "H" | "V"): Shape => {
    if (node.type === "leaf") return node.data.views;
    const c = node.data.map((n) => walk(n, o === "H" ? "V" : "H"));
    return c.length === 0 ? [] : c.length === 1 ? c[0] : { o, c };
  };
  const grid = api.toJSON().grid;
  return walk(grid.root as unknown as Node, grid.orientation === "HORIZONTAL" ? "H" : "V");
}

/** กรอบของกลุ่มลอยกลุ่มที่ index (dockview เก็บ AnchoredBox เป็น union แต่ toJSON ให้ top/left/width/height เสมอ) */
const floatBox = (api: DockviewApi, index = 0) =>
  api.toJSON().floatingGroups![index].position as unknown as { top: number; left: number; width: number; height: number };

/**
 * หน้าต่างลอยวางกลางพื้นที่กลางที่ dockview ให้ลอย (กริดกลาง = api.width x api.height ซึ่งไม่รวม edge group ที่เกาะขอบ เพราะลอยทับ edge group ไม่ได้)
 * พิกัดนับจากมุมของพื้นที่นั้น
 */
function expectCentred(api: DockviewApi, box: { top: number; left: number; width: number; height: number }) {
  expect(api.width).toBeGreaterThan(box.width); // พื้นที่กว้างกว่าหน้าต่าง ไม่งั้นกลางจอไม่มีความหมาย
  expect(api.height).toBeGreaterThan(box.height);
  expect(box.left + box.width / 2).toBeCloseTo(api.width / 2, 0);
  expect(box.top + box.height / 2).toBeCloseTo(api.height / 2, 0);
}

const loc = (id: string) => apiOf().getPanel(id)?.api.location;
const groupOf = (id: string) => apiOf().getPanel(id)?.group.id;
const titles = (api: DockviewApi) => api.panels.map((p) => p.title ?? "");
const warnings = () => useMessages.getState().items.filter((m) => m.level === "warning");

/** ที่อยู่ของทุกหน้าต่าง: id -> ชื่อ, ชนิดตำแหน่ง และสมาชิกของกลุ่มเดียวกัน (ไม่ใช้เลขกลุ่ม เพราะ dockview ให้เลขใหม่เมื่อสร้างซ้ำ) */
function snapshot(api: DockviewApi) {
  return Object.fromEntries(
    api.panels.map((p) => [
      p.id,
      { title: p.title, location: p.api.location, group: p.group.panels.map((q) => q.id) },
    ]),
  );
}

beforeEach(() => {
  useLayout.setState(useLayout.getInitialState(), true);
  useMessages.setState(useMessages.getInitialState(), true);
  useScenario.setState(useScenario.getInitialState(), true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("registry", () => {
  const FLOATING: PanelKind[] = [
    "propertiesBrowser", "insertObjects", "satelliteCatalog", "newScenarioWizard", "welcome", "viewFromTo", "windowProperties3d",
    "windowProperties2d", "fetchOrbitData", "dailyForecastSettings", "about", "stkReference",
  ];

  test("every panel kind has a placeholder with the spec §4.1 window type", () => {
    for (const kind of PANEL_KINDS) expect(getPanelDef(kind), kind).toBeDefined();
    for (const kind of ["objectBrowser", "timelineView", "messageViewer"] as const) expect(getPanelDef(kind)?.type, kind).toBe("dockable");
    for (const kind of ["graphics3d", "graphics2d"] as const) expect(getPanelDef(kind)?.type, kind).toBe("integrated");
    for (const kind of FLOATING) expect(getPanelDef(kind)?.type, kind).toBe("floating");
  });

  test("only the five workspace windows are saved in the workbook (persist)", () => {
    const persisted = PANEL_KINDS.filter((kind) => getPanelDef(kind)?.persist === true).sort();
    expect(persisted).toEqual(["graphics2d", "graphics3d", "messageViewer", "objectBrowser", "timelineView"]);
    for (const kind of PANEL_KINDS) expect(typeof getPanelDef(kind)?.persist, kind).toBe("boolean");
  });

  test("the windows that depend on the open scenario are the ones closed with it (scenarioBound)", () => {
    const bound = PANEL_KINDS.filter((kind) => getPanelDef(kind)?.scenarioBound === true).sort();
    expect(bound).toEqual(["insertObjects", "propertiesBrowser", "satelliteCatalog", "viewFromTo", "windowProperties2d", "windowProperties3d"]);
    for (const kind of PANEL_KINDS) expect(typeof getPanelDef(kind)?.scenarioBound, kind).toBe("boolean");
  });

  test("3D and 2D windows are never singletons, everything else is", () => {
    for (const kind of PANEL_KINDS) expect(getPanelDef(kind)?.singleton, kind).toBe(kind !== "graphics3d" && kind !== "graphics2d");
  });

  test("window titles come from the labels table, the 3D/2D ones numbered by params.n", () => {
    expect(getPanelDef("objectBrowser")?.title({})).toBe("Object Browser");
    expect(getPanelDef("graphics3d")?.title({ n: 2 })).toBe("3D Graphics 2 - Earth");
    expect(getPanelDef("graphics2d")?.title({ n: 3 })).toBe("2D Graphics 3 - Earth");
    expect(getPanelDef("graphics3d")?.title(undefined)).toBe("3D Graphics 1 - Earth");
    expect(getPanelDef("windowProperties3d")?.title({})).toBe(t("window.properties3d"));
    expect(getPanelDef("about")?.title({})).toBe(t("help.about"));
  });

  test("the placeholder shows the window title and the muted not-yet-built note", async () => {
    await mount();
    st().openPanel("propertiesBrowser");
    const panel = await screen.findByText("Properties Browser", { selector: ".panel-placeholder-title" });
    expect(panel.parentElement).toHaveProperty("className", "panel-placeholder");
    expect(within(panel.parentElement!).getByText("ยังไม่ทำ (งานถัดไป)")).toBeDefined();
  });

  describe("re-registering", () => {
    let original: PanelDef;
    beforeEach(() => {
      original = getPanelDef("graphics3d")!;
    });
    afterEach(() => registerPanel("graphics3d", original));

    test("replaces the window that is already open and hands it its params and panel id", async () => {
      await mount();
      await screen.findAllByText("ยังไม่ทำ (งานถัดไป)");
      act(() => registerPanel("graphics3d", { ...original, component: ({ panelId, params }) => <div>REAL {panelId} n={params.n}</div> }));
      expect(await screen.findByText("REAL graphics3d n=1")).toBeDefined();
      // หน้าต่างที่เปิดใหม่หลังจากนั้นก็ใช้ตัวจริง
      act(() => void st().newGraphicsWindow("graphics3d"));
      expect(await screen.findByText("REAL graphics3d-2 n=2")).toBeDefined();
    });
  });
});

describe("applyDefault (spec §4.2)", () => {
  test("builds five windows: Object Browser left, 3D and 2D side by side, Timeline View and Message Viewer in one group at the bottom", async () => {
    const { api } = await mount();
    st().applyDefault();
    expect(titles(api).sort()).toEqual(["2D Graphics 1 - Earth", "3D Graphics 1 - Earth", "Message Viewer", "Object Browser", "Timeline View"]);

    expect(loc("objectBrowser")).toEqual({ type: "edge", position: "left" });

    expect(groupOf("graphics3d")).not.toBe(groupOf("graphics2d"));
    expect(loc("graphics3d")?.type).toBe("grid");
    expect(loc("graphics2d")?.type).toBe("grid");
    expect(gridShape(api)).toEqual({ o: "H", c: [["graphics3d"], ["graphics2d"]] });

    expect(groupOf("timelineView")).toBe(groupOf("messageViewer"));
    expect(loc("timelineView")).toEqual({ type: "edge", position: "bottom" });
    expect(api.getPanel("timelineView")?.group.activePanel?.id).toBe("timelineView");
  });

  test("the workspace shows it as soon as it is mounted", async () => {
    const { api } = await mount();
    expect(api.panels).toHaveLength(5);
  });

  test("calling it again replaces whatever is open (and is repeatable)", async () => {
    const { api } = await mount();
    st().openPanel("propertiesBrowser");
    st().newGraphicsWindow("graphics3d");
    expect(api.panels).toHaveLength(7);
    st().applyDefault();
    st().applyDefault();
    expect(api.panels).toHaveLength(5);
    expect(api.groups.filter((g) => g.panels.length === 0)).toEqual([]);
    expect(api.toJSON().floatingGroups ?? []).toEqual([]);
  });

  test("also resets toolbars, hidden timeline rows and window settings", async () => {
    await mount();
    st().setToolbar("graphics3d", true);
    useLayout.setState({ timelineHidden: ["G01"], windowProps: { graphics3d: { a: 1 } } });
    st().applyDefault();
    expect(st().toolbars).toEqual({ default: true, animation: true, graphics3d: false, defaults3d: false, defaults2d: false });
    expect(st().timelineHidden).toEqual([]);
    expect(st().windowProps).toEqual({});
  });
});

describe("listWindows", () => {
  test("gives id, title and the spec §4.1 type of each window", async () => {
    await mount();
    st().openPanel("propertiesBrowser");
    const byId = Object.fromEntries(st().listWindows().map((w) => [w.id, w]));
    expect(byId.objectBrowser).toEqual({ id: "objectBrowser", title: "Object Browser", type: "dockable" });
    expect(byId.graphics3d).toEqual({ id: "graphics3d", title: "3D Graphics 1 - Earth", type: "integrated" });
    expect(byId.graphics2d.type).toBe("integrated");
    expect(byId.timelineView.type).toBe("dockable");
    expect(byId.messageViewer.type).toBe("dockable");
    expect(byId.propertiesBrowser).toEqual({ id: "propertiesBrowser", title: "Properties Browser", type: "floating" });
    expect(Object.keys(byId)).toHaveLength(6);
  });

  test("is empty before the workspace is mounted", () => {
    expect(st().listWindows()).toEqual([]);
  });
});

describe("openPanel", () => {
  test("a floating window opens as a floating group centred in the workspace", async () => {
    const { api } = await mount();
    act(() => api.layout(1600, 1200, true));
    const id = st().openPanel("propertiesBrowser");
    expect(id).toBe("propertiesBrowser");
    expect(loc(id)).toEqual({ type: "floating" });
    const box = floatBox(api);
    const size = getPanelDef("propertiesBrowser")!.size!;
    expect(box).toMatchObject({ width: size.width, height: size.height });
    expectCentred(api, box);
  });

  test("opens with the title and params it was given", async () => {
    const { api } = await mount();
    const id = st().openPanel("windowProperties3d", { target: "graphics3d" });
    expect(api.getPanel(id)?.title).toBe(t("window.properties3d"));
    expect(api.getPanel(id)?.params).toEqual({ target: "graphics3d" });
  });

  test("a dockable window opens in the edge group of its side", async () => {
    const { api } = await mount();
    st().closePanel("objectBrowser");
    expect(api.getPanel("objectBrowser")).toBeUndefined();
    st().openPanel("objectBrowser");
    expect(loc("objectBrowser")).toEqual({ type: "edge", position: "left" });
    expect(api.isEdgeGroupVisible("left")).toBe(true);
  });

  test("a singleton that is already open is focused, not opened twice", async () => {
    const { api } = await mount();
    const first = st().openPanel("propertiesBrowser");
    api.getPanel("graphics3d")!.api.setActive();
    expect(api.activePanel?.id).toBe("graphics3d");
    const second = st().openPanel("propertiesBrowser", { ignored: true });
    expect(second).toBe(first);
    expect(api.panels.filter((p) => p.api.component === "propertiesBrowser")).toHaveLength(1);
    expect(api.activePanel?.id).toBe(first);
  });

  test("a singleton in a collapsed edge group is expanded when it is opened again", async () => {
    const { api } = await mount();
    api.getPanel("objectBrowser")!.group.api.collapse();
    expect(api.getPanel("objectBrowser")!.group.api.isCollapsed()).toBe(true);
    st().openPanel("objectBrowser");
    expect(api.getPanel("objectBrowser")!.group.api.isCollapsed()).toBe(false);
  });

  test("an unknown kind is refused", async () => {
    await mount();
    expect(() => st().openPanel("nope" as PanelKind)).toThrow();
  });

  test("throws when the workspace is not mounted", () => {
    expect(() => st().openPanel("propertiesBrowser")).toThrow();
  });
});

describe("newGraphicsWindow", () => {
  test("opens the next numbered window as a new group to the right, in the centre area", async () => {
    const { api } = await mount();
    const id = st().newGraphicsWindow("graphics3d");
    expect(id).toBe("graphics3d-2");
    expect(api.getPanel(id)?.title).toBe("3D Graphics 2 - Earth");
    expect(api.getPanel(id)?.params).toEqual({ n: 2 });
    expect(loc(id)?.type).toBe("grid");
    expect(gridShape(api)).toEqual({ o: "H", c: [["graphics3d"], ["graphics2d"], ["graphics3d-2"]] });
    expect(st().newGraphicsWindow("graphics2d")).toBe("graphics2d-2");
    expect(api.getPanel("graphics2d-2")?.title).toBe("2D Graphics 2 - Earth");
    expect(api.activePanel?.id).toBe("graphics2d-2");
  });

  test("a closed number is reused and ids stay unique", async () => {
    const { api } = await mount();
    const a = st().newGraphicsWindow("graphics3d");
    const b = st().newGraphicsWindow("graphics3d");
    expect([a, b]).toEqual(["graphics3d-2", "graphics3d-3"]);
    st().closePanel(a);
    expect(titles(api).filter((x) => x.startsWith("3D"))).toEqual(["3D Graphics 1 - Earth", "3D Graphics 3 - Earth"]);
    const c = st().newGraphicsWindow("graphics3d");
    expect(c).toBe("graphics3d-2");
    expect(api.getPanel(c)?.title).toBe("3D Graphics 2 - Earth");
    st().closePanel("graphics3d");
    const d = st().newGraphicsWindow("graphics3d");
    expect(d).toBe("graphics3d");
    expect(api.getPanel(d)?.title).toBe("3D Graphics 1 - Earth");
  });

  test("a new window does not inherit the settings of a closed one with the same id", async () => {
    await mount();
    const a = st().newGraphicsWindow("graphics3d");
    st().setWindowProps(a, { showLabels: true });
    apiOf().removePanel(apiOf().getPanel(a)!); // ปิดจากปุ่ม X ของแท็บ (ไม่ผ่าน closePanel)
    const b = st().newGraphicsWindow("graphics3d");
    expect(b).toBe(a);
    expect(st().windowProps[b]).toBeUndefined();
  });
});

describe("closePanel", () => {
  test("removes the window; an unknown id is ignored", async () => {
    const { api } = await mount();
    st().closePanel("graphics2d");
    expect(api.getPanel("graphics2d")).toBeUndefined();
    expect(gridShape(api)).toEqual(["graphics3d"]);
    expect(() => st().closePanel("nope")).not.toThrow();
  });

  test("forgets the settings of the closed window", async () => {
    await mount();
    st().setWindowProps("graphics2d", { a: 1 });
    st().closePanel("graphics2d");
    expect(st().windowProps.graphics2d).toBeUndefined();
  });
});

describe("setType", () => {
  test("Floating moves a docked window into a floating group at the centre", async () => {
    const { api } = await mount();
    act(() => api.layout(1600, 1200, true));
    st().setType("objectBrowser", "floating");
    expect(loc("objectBrowser")).toEqual({ type: "floating" });
    const box = floatBox(api);
    expectCentred(api, box);
    expect(st().listWindows().find((w) => w.id === "objectBrowser")?.type).toBe("floating");
  });

  test("Integrated puts a window into the centre area, Dockable into the edge group of its side", async () => {
    const { api } = await mount();
    const id = st().openPanel("propertiesBrowser");
    st().setType(id, "integrated");
    expect(loc(id)?.type).toBe("grid");
    expect(gridShape(api)).toEqual({ o: "H", c: [["graphics3d"], ["graphics2d"], [id]] });
    st().setType(id, "dockable");
    expect(loc(id)).toEqual({ type: "edge", position: "bottom" });
    expect(groupOf(id)).toBe(groupOf("timelineView"));
    st().setType(id, "floating");
    expect(loc(id)).toEqual({ type: "floating" });
  });

  test("an emptied dock side comes back when a window is docked there again", async () => {
    const { api } = await mount();
    st().setType("objectBrowser", "floating");
    st().setType("objectBrowser", "integrated");
    expect(loc("objectBrowser")?.type).toBe("grid");
    st().setType("objectBrowser", "dockable");
    expect(loc("objectBrowser")).toEqual({ type: "edge", position: "left" });
    expect(api.isEdgeGroupVisible("left")).toBe(true);
    expect(api.getPanel("objectBrowser")!.group.api.isCollapsed()).toBe(false);
  });

  test("the same type again, or an unknown id, changes nothing", async () => {
    const { api } = await mount();
    const before = JSON.stringify(api.toJSON());
    st().setType("graphics3d", "integrated");
    st().setType("objectBrowser", "dockable");
    st().setType("nope", "floating");
    expect(JSON.stringify(api.toJSON())).toBe(before);
  });

  test("the last window leaving the centre area leaves the other panels alone", async () => {
    const { api } = await mount();
    st().setType("graphics3d", "floating");
    st().setType("graphics2d", "floating");
    expect(gridShape(api)).toEqual([]);
    expect(api.panels).toHaveLength(5);
    st().setType("graphics3d", "integrated");
    expect(gridShape(api)).toEqual(["graphics3d"]);
  });
});

describe("tile and cascade", () => {
  test("tile(vertical) puts every integrated window side by side, tile(horizontal) stacks them", async () => {
    const { api } = await mount();
    st().newGraphicsWindow("graphics3d");
    st().tile("horizontal");
    expect(gridShape(api)).toEqual({ o: "V", c: [["graphics3d"], ["graphics2d"], ["graphics3d-2"]] });
    st().tile("vertical");
    expect(gridShape(api)).toEqual({ o: "H", c: [["graphics3d"], ["graphics2d"], ["graphics3d-2"]] });
  });

  test("tile splits tabbed windows into their own groups", async () => {
    const { api } = await mount();
    st().newGraphicsWindow("graphics3d");
    st().cascade();
    expect(gridShape(api)).toEqual(["graphics3d", "graphics2d", "graphics3d-2"]);
    st().tile("vertical");
    expect(gridShape(api)).toEqual({ o: "H", c: [["graphics3d"], ["graphics2d"], ["graphics3d-2"]] });
  });

  test("cascade merges all integrated windows into one tabbed group, in order", async () => {
    const { api } = await mount();
    st().newGraphicsWindow("graphics2d");
    st().cascade();
    expect(gridShape(api)).toEqual(["graphics3d", "graphics2d", "graphics2d-2"]);
    expect(api.groups.filter((g) => g.api.location.type === "grid")).toHaveLength(1);
  });

  test("only integrated windows move: docked and floating windows stay where they are", async () => {
    const { api } = await mount();
    st().openPanel("propertiesBrowser");
    st().newGraphicsWindow("graphics3d");
    const before = { ob: loc("objectBrowser"), tl: groupOf("timelineView"), pb: loc("propertiesBrowser") };
    st().cascade();
    st().tile("horizontal");
    expect({ ob: loc("objectBrowser"), tl: groupOf("timelineView"), pb: loc("propertiesBrowser") }).toEqual(before);
    expect(api.panels).toHaveLength(7);
  });

  test("with fewer than two integrated windows there is nothing to do", async () => {
    const { api } = await mount();
    st().closePanel("graphics2d");
    const before = JSON.stringify(api.toJSON());
    st().tile("vertical");
    st().cascade();
    expect(JSON.stringify(api.toJSON())).toBe(before);
  });

  test("the window that was active stays active", async () => {
    const { api } = await mount();
    st().newGraphicsWindow("graphics3d");
    api.getPanel("graphics2d")!.api.setActive();
    st().tile("horizontal");
    expect(api.activePanel?.id).toBe("graphics2d");
    st().cascade();
    expect(api.activePanel?.id).toBe("graphics2d");
  });
});

describe("tab context menu", () => {
  const tabOf = (container: HTMLElement, id: string) => container.querySelector(`[data-tab-panel-id="${id}"]`)!;

  test("right-clicking a window title offers Dockable, Floating and Integrated; the current type is disabled", async () => {
    const { container } = await mount();
    fireEvent.contextMenu(tabOf(container, "graphics3d"));
    const items = [...document.querySelectorAll(".dv-context-menu-item")];
    expect(items.map((i) => i.textContent)).toEqual([t("window.mode.dockable"), t("window.mode.floating"), t("window.mode.integrated")]);
    expect(items.map((i) => i.classList.contains("dv-context-menu-item--disabled"))).toEqual([false, false, true]);
  });

  test("choosing a type moves the window", async () => {
    const { container } = await mount();
    fireEvent.contextMenu(tabOf(container, "graphics3d"));
    fireEvent.click(screen.getByText("Floating"));
    expect(loc("graphics3d")).toEqual({ type: "floating" });

    fireEvent.contextMenu(tabOf(container, "objectBrowser"));
    fireEvent.click(screen.getByText("Integrated"));
    expect(loc("objectBrowser")?.type).toBe("grid");
  });
});

describe("panel resize notification", () => {
  test("onPanelResize calls back with the new size until it is unsubscribed", async () => {
    const { api } = await mount();
    const cb = vi.fn();
    const off = st().onPanelResize("graphics3d", cb);
    act(() => api.layout(800, 600, true));
    expect(cb).toHaveBeenCalled();
    expect(cb).toHaveBeenLastCalledWith(expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }));
    cb.mockClear();
    off();
    act(() => api.layout(700, 500, true));
    expect(cb).not.toHaveBeenCalled();
  });

  test("it also fires when the window becomes visible again (a hidden tab being shown)", async () => {
    const { api } = await mount();
    st().cascade();
    api.getPanel("graphics2d")!.api.setActive();
    const cb = vi.fn();
    st().onPanelResize("graphics3d", cb);
    api.getPanel("graphics3d")!.api.setActive();
    expect(cb).toHaveBeenCalled();
  });

  test("an unknown window gives a harmless unsubscribe", async () => {
    await mount();
    expect(() => st().onPanelResize("nope", vi.fn())()).not.toThrow();
  });

  test("usePanelResize lets a panel component resize its viewer", async () => {
    const original = getPanelDef("graphics3d")!;
    const resized = vi.fn();
    function Viewer({ panelId }: { panelId: string }) {
      usePanelResize(panelId, resized);
      return <div>viewer {panelId}</div>;
    }
    try {
      const { api } = await mount();
      act(() => registerPanel("graphics3d", { ...original, component: Viewer }));
      await screen.findByText("viewer graphics3d");
      resized.mockClear();
      act(() => api.layout(900, 650, true));
      expect(resized).toHaveBeenCalled();
    } finally {
      registerPanel("graphics3d", original);
    }
  });
});

describe("workspace slots", () => {
  test("the header slot sits above the dockview and the footer slot below it", async () => {
    const { container } = await mount({ header: <div data-testid="header">H</div>, footer: <div data-testid="footer">F</div> });
    const header = screen.getByTestId("header");
    const footer = screen.getByTestId("footer");
    const dock = container.querySelector(".dv-dockview")!;
    expect(dock).not.toBeNull();
    expect(header.compareDocumentPosition(dock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dock.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("unmounting detaches the api", async () => {
    const { unmount } = await mount();
    unmount();
    expect(st().api).toBeNull();
  });
});

describe("toWorkbook / fromWorkbook (W6)", () => {
  test("toWorkbook has the contract shape and validates", async () => {
    const { api } = await mount();
    const w = st().toWorkbook();
    expect(validateWorkbook(w)).not.toBeNull();
    expect(w.version).toBe(1);
    expect(w.dockview).toEqual(JSON.parse(JSON.stringify(api.toJSON())));
    expect(Object.keys(w.panels).sort()).toEqual(["graphics2d", "graphics3d", "messageViewer", "objectBrowser", "timelineView"]);
    expect(w.panels.graphics3d).toEqual({ kind: "graphics3d", params: { n: 1 } });
    expect(w.panels.objectBrowser).toEqual({ kind: "objectBrowser", params: {} });
    expect(w.toolbars).toEqual({ default: true, animation: true, graphics3d: false, defaults3d: false, defaults2d: false });
    expect(w.timelineHidden).toEqual([]);
    expect(w.windowProps).toEqual({});
  });

  test("a workbook round trip on a new api gives back the same panel ids, titles and groups", async () => {
    const first = await mount();
    st().newGraphicsWindow("graphics2d");
    st().setType("messageViewer", "floating");
    st().tile("horizontal");
    st().setToolbar("graphics3d", true);
    useLayout.setState({ timelineHidden: ["G01", "G02"], windowProps: { graphics3d: { showLabels: false } } });
    const saved = st().toWorkbook();
    expect(validateWorkbook(saved)).not.toBeNull();
    const before = snapshot(first.api);
    const wire = JSON.parse(JSON.stringify(saved)) as Workbook; // สิ่งที่ server เก็บและส่งคืน
    first.unmount();

    const second = await mount();
    expect(second.api).not.toBe(first.api);
    st().fromWorkbook(wire);
    expect(snapshot(second.api)).toEqual(before);
    expect(gridShape(second.api)).toEqual({ o: "V", c: [["graphics3d"], ["graphics2d"], ["graphics2d-2"]] });
    expect(st().toWorkbook()).toEqual(saved);
    expect(st().toolbars.graphics3d).toBe(true);
    expect(warnings()).toEqual([]);
  });

  test("timelineHidden and windowProps that were loaded come back out unchanged", async () => {
    await mount();
    const wire = JSON.parse(JSON.stringify(st().toWorkbook())) as Workbook;
    wire.timelineHidden = ["G05", "R03"];
    wire.windowProps = { graphics3d: { grid: true, nested: { a: [1, 2] } }, "graphics2d-9": { x: 1 } };
    st().fromWorkbook(wire);
    const w = st().toWorkbook();
    expect(w.timelineHidden).toEqual(["G05", "R03"]);
    expect(w.windowProps).toEqual(wire.windowProps);
  });

  test("window titles come from the labels table, not from the saved file", async () => {
    await mount();
    const wire = JSON.parse(JSON.stringify(st().toWorkbook())) as Workbook;
    (wire.dockview.panels as Record<string, { title: string }>).objectBrowser.title = "OLD NAME";
    (wire.dockview.panels as Record<string, { title: string }>).graphics3d.title = "OLD 3D";
    st().fromWorkbook(wire);
    expect(apiOf().getPanel("objectBrowser")?.title).toBe("Object Browser");
    expect(apiOf().getPanel("graphics3d")?.title).toBe("3D Graphics 1 - Earth");
  });

  describe("kinds this version does not know", () => {
    /** เพิ่มหน้าต่างชนิดแปลกเข้า workbook: id -> kind (ทั้งใน dockview และ panels) โดยใส่กลุ่มที่มีอยู่แล้วหรือกลุ่มลอยของตัวเอง */
    function withGhosts(ghosts: Record<string, { kind: string; floating?: boolean }>): Workbook {
      const wire = JSON.parse(JSON.stringify(st().toWorkbook())) as Workbook;
      const dv = wire.dockview as {
        panels: Record<string, unknown>;
        floatingGroups?: unknown[];
        edgeGroups: { bottom: { group: { views: string[] } } };
      };
      for (const [id, g] of Object.entries(ghosts)) {
        dv.panels[id] = { id, contentComponent: g.kind, title: `ghost ${id}` };
        wire.panels[id] = { kind: g.kind, params: {} };
        if (g.floating) {
          dv.floatingGroups = [...(dv.floatingGroups ?? []), { data: { views: [id], activeView: id, id: `ghost-${id}` }, position: { top: 10, left: 10, width: 200, height: 100 } }];
        } else {
          dv.edgeGroups.bottom.group.views.push(id);
        }
      }
      return wire;
    }

    test("are skipped with one warning per kind and everything else is restored", async () => {
      const { api } = await mount();
      const wire = withGhosts({ a: { kind: "holodeck" }, b: { kind: "holodeck", floating: true }, c: { kind: "warpCore" } });
      st().fromWorkbook(wire);
      expect(api.panels.map((p) => p.id).sort()).toEqual(["graphics2d", "graphics3d", "messageViewer", "objectBrowser", "timelineView"]);
      const w = warnings();
      expect(w).toHaveLength(2);
      expect(w.map((m) => m.text).sort()).toEqual([msg("workbook.unknownKind", { kind: "holodeck" }), msg("workbook.unknownKind", { kind: "warpCore" })].sort());
      expect(w.every((m) => m.code === "WORKBOOK_UNKNOWN_KIND")).toBe(true);
    });

    test("leave no empty group and no ghost entry behind", async () => {
      const { api } = await mount();
      st().fromWorkbook(withGhosts({ only: { kind: "holodeck", floating: true } }));
      expect(api.groups.filter((g) => g.panels.length === 0)).toEqual([]);
      expect(api.toJSON().floatingGroups ?? []).toEqual([]);
      expect(Object.keys(st().toWorkbook().panels)).not.toContain("only");
    });

    test("a panel whose entry disagrees with dockview about the kind is skipped too", async () => {
      const { api } = await mount();
      const wire = JSON.parse(JSON.stringify(st().toWorkbook())) as Workbook;
      wire.panels.objectBrowser.kind = "holodeck";
      st().fromWorkbook(wire);
      expect(api.getPanel("objectBrowser")).toBeUndefined();
      expect(warnings()).toHaveLength(1);
    });
  });

  test("a workbook that is not valid is replaced by the default layout, with a warning", async () => {
    const { api } = await mount();
    st().openPanel("propertiesBrowser");
    st().fromWorkbook({ version: 2, dockview: {}, panels: {} });
    expect(api.panels).toHaveLength(5);
    expect(warnings().map((m) => m.code)).toEqual(["WORKBOOK_INVALID"]);
    expect(warnings()[0].text).toBe(msg("workbook.invalid"));
  });

  test("a layout dockview cannot build falls back to the default layout, with a warning", async () => {
    const { api } = await mount();
    st().openPanel("propertiesBrowser");
    const wire = JSON.parse(JSON.stringify(st().toWorkbook())) as Workbook;
    wire.dockview = { grid: "garbage", panels: { objectBrowser: { id: "objectBrowser", contentComponent: "objectBrowser", title: "x" } } };
    wire.panels = { objectBrowser: { kind: "objectBrowser", params: {} } };
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined); // dockview logs the failed rebuild
    try {
      st().fromWorkbook(wire);
    } finally {
      logged.mockRestore();
    }
    expect(api.panels.map((p) => p.id).sort()).toEqual(["graphics2d", "graphics3d", "messageViewer", "objectBrowser", "timelineView"]);
    expect(loc("objectBrowser")).toEqual({ type: "edge", position: "left" });
    expect(warnings().map((m) => m.code)).toEqual(["WORKBOOK_RESTORE_FAILED"]);
  });
});

describe("which windows the workbook keeps", () => {
  const WORKSPACE = ["graphics2d", "graphics3d", "messageViewer", "objectBrowser", "timelineView"];
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
  const noEmptyGroups = (api: DockviewApi) => api.groups.filter((g) => g.panels.length === 0 && g.api.location.type !== "edge").map((g) => g.id);

  /** Welcome, About and a Properties Browser, one in each kind of place (floating, dockable at the bottom, integrated in the grid) */
  function openTransient() {
    st().openPanel("welcome");
    st().openPanel("about");
    st().openPanel("propertiesBrowser", { path: "*/Satellite/G01" });
  }

  test("saving while Welcome, About and a Properties Browser are open leaves all three out", async () => {
    await mount();
    openTransient();
    useLayout.setState({ windowProps: { graphics3d: { showLabels: false }, welcome: { x: 1 }, "propertiesBrowser": { y: 2 } } });
    const w = st().toWorkbook();
    expect(Object.keys(w.panels).sort()).toEqual(WORKSPACE);
    expect(Object.keys(w.dockview.panels as object).sort()).toEqual(WORKSPACE);
    expect(JSON.stringify(w)).not.toMatch(/welcome|about|propertiesBrowser|Satellite\/G01/);
    expect(w.windowProps).toEqual({ graphics3d: { showLabels: false } });
    expect(validateWorkbook(w)).not.toBeNull();
  });

  test("the saved file goes over the wire and PUT sends exactly that", async () => {
    await mount();
    useScenario.setState({ name: "E2E" });
    openTransient();
    const fetch = stubFetch({ "PUT /api/scenarios/E2E/workbook": { status: 204 } });
    await st().saveWorkbook();
    const body = fetch.calls[0].body as Workbook;
    expect(Object.keys(body.panels).sort()).toEqual(WORKSPACE);
    expect(JSON.stringify(body)).not.toMatch(/welcome|about|propertiesBrowser/);
  });

  test("windows that were moved into the grid, onto an edge or alone in their own group are left out as well", async () => {
    await mount();
    openTransient();
    st().setType("welcome", "integrated"); // alone in a grid group of its own
    st().setType("about", "dockable"); // tabbed with the Timeline View and the Message Viewer
    st().openPanel("insertObjects");
    st().setType("insertObjects", "dockable"); // also tabbed into the bottom edge group
    const w = st().toWorkbook();
    expect(Object.keys(w.panels).sort()).toEqual(WORKSPACE);
    expect(JSON.stringify(w.dockview)).not.toMatch(/welcome|about|propertiesBrowser|insertObjects/);
  });

  test("restoring that file shows only the workspace windows, laid out as they were without the others", async () => {
    const first = await mount();
    st().setType("messageViewer", "floating");
    const before = snapshot(first.api);
    const shape = gridShape(first.api);
    openTransient();
    st().setType("welcome", "integrated");
    const wire = clone(st().toWorkbook());
    first.unmount();

    const second = await mount();
    st().fromWorkbook(wire);
    expect(second.api.panels.map((p) => p.id).sort()).toEqual(WORKSPACE);
    expect(snapshot(second.api)).toEqual(before);
    expect(gridShape(second.api)).toEqual(shape);
    expect(noEmptyGroups(second.api)).toEqual([]);
    expect(warnings()).toEqual([]);
  });

  test("a workbook saved before this rule, with Welcome, About, a Properties Browser and their windowProps in it, restores without them", async () => {
    const { api } = await mount();
    openTransient();
    st().setType("welcome", "integrated");
    const old: Workbook = {
      version: 1,
      dockview: clone(api.toJSON()) as unknown as Record<string, unknown>,
      panels: Object.fromEntries(api.panels.map((p) => [p.id, { kind: p.api.component, params: clone(p.params ?? {}) }])),
      toolbars: { default: true, animation: true, graphics3d: false, defaults3d: false, defaults2d: false },
      timelineHidden: [],
      windowProps: { graphics3d: { showLabels: false }, welcome: { x: 1 }, propertiesBrowser: { y: 2 } },
    };
    expect(Object.keys(old.panels)).toContain("welcome");
    st().applyDefault();
    st().fromWorkbook(old);
    expect(api.panels.map((p) => p.id).sort()).toEqual(WORKSPACE);
    expect(noEmptyGroups(api)).toEqual([]);
    expect(warnings()).toEqual([]);
    expect(st().windowProps).toEqual({ graphics3d: { showLabels: false } });
    expect(st().toWorkbook().windowProps).toEqual({ graphics3d: { showLabels: false } });
  });

  test("windowProps of an id that has no window at all are kept (they belong to a workspace window that is not open yet)", async () => {
    await mount();
    const wire = clone(st().toWorkbook());
    wire.windowProps = { "graphics2d-9": { x: 1 } };
    st().fromWorkbook(wire);
    expect(st().toWorkbook().windowProps).toEqual({ "graphics2d-9": { x: 1 } });
  });

  test("with nothing transient open the file is exactly what dockview serialises", async () => {
    const { api } = await mount();
    expect(st().toWorkbook().dockview).toEqual(clone(api.toJSON()));
  });
});

describe("saveWorkbook (W5)", () => {
  test("PUTs the workbook to the open scenario without If-Match", async () => {
    await mount();
    useScenario.setState({ name: "My Scn" });
    const fetch = stubFetch({ "PUT /api/scenarios/My%20Scn/workbook": { status: 204 } });
    await st().saveWorkbook();
    expect(fetch.calls).toHaveLength(1);
    const call = fetch.calls[0];
    expect(call.method).toBe("PUT");
    expect(call.headers.has("If-Match")).toBe(false);
    expect(call.body).toEqual(JSON.parse(JSON.stringify(st().toWorkbook())));
    expect(validateWorkbook(call.body)).not.toBeNull();
    expect(useMessages.getState().items).toEqual([]);
  });

  test("rejects over 1,048,576 bytes: nothing is sent and the Thai message is added", async () => {
    await mount();
    useScenario.setState({ name: "E2E" });
    const fetch = stubFetch({ "PUT /api/scenarios/E2E/workbook": { status: 204 } });
    useLayout.setState({ windowProps: { graphics3d: { pad: "a".repeat(WORKBOOK_MAX_BYTES) } } });
    expect(workbookBytes(st().toWorkbook())).toBeGreaterThan(WORKBOOK_MAX_BYTES);
    await expect(st().saveWorkbook()).rejects.toThrow();
    expect(fetch.calls).toEqual([]);
    const [m] = useMessages.getState().items;
    expect(m).toMatchObject({ level: "error", code: "WORKBOOK_TOO_LARGE", text: msg("workbook.tooLarge") });
  });

  test("a server failure rejects and shows the server's own text", async () => {
    await mount();
    useScenario.setState({ name: "E2E" });
    stubFetch({ "PUT /api/scenarios/E2E/workbook": { status: 422, json: { code: "WORKBOOK_TOO_LARGE", text: "workbook ใหญ่เกินไป", field: null, detail: null } } });
    await expect(st().saveWorkbook()).rejects.toBeInstanceOf(ApiError);
    const [m] = useMessages.getState().items;
    expect(m).toMatchObject({ level: "error", code: "WORKBOOK_TOO_LARGE" });
    expect(m.text).toBe(msg("workbook.saveFailed", { message: "workbook ใหญ่เกินไป" }));
  });

  test("with no scenario open it rejects with a Thai message, shows it in the Message Viewer and sends nothing", async () => {
    await mount();
    const fetch = stubFetch({});
    const failure = await st().saveWorkbook().then(() => null, (e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(msg("workbook.noScenario"));
    expect((failure as Error).message).toMatch(/[\u0E00-\u0E7F]/);
    expect(fetch.calls).toEqual([]);
    expect(useMessages.getState().items).toHaveLength(1);
    expect(useMessages.getState().items[0]).toMatchObject({ level: "error", code: "WORKBOOK_NO_SCENARIO", text: msg("workbook.noScenario") });
  });

  test("before the workspace is mounted it rejects with a Thai message, shows it and sends nothing", async () => {
    useScenario.setState({ name: "E2E" });
    const fetch = stubFetch({ "PUT /api/scenarios/E2E/workbook": { status: 204 } });
    const failure = await st().saveWorkbook().then(() => null, (e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(msg("workbook.noWorkspace"));
    expect((failure as Error).message).toMatch(/[\u0E00-\u0E7F]/);
    expect(fetch.calls).toEqual([]);
    expect(useMessages.getState().items).toHaveLength(1);
    expect(useMessages.getState().items[0]).toMatchObject({ level: "error", code: "WORKBOOK_NO_WORKSPACE", text: msg("workbook.noWorkspace") });
  });
});

describe("restoreFor (spec §4.2)", () => {
  const url = "GET /api/scenarios/E2E/workbook";

  test("applies the saved workbook when the scenario has one", async () => {
    const { api } = await mount();
    st().newGraphicsWindow("graphics3d");
    st().setType("timelineView", "floating");
    const saved = JSON.parse(JSON.stringify(st().toWorkbook())) as Workbook;
    st().applyDefault();
    expect(api.panels).toHaveLength(5);
    stubFetch({ [url]: { json: saved } });
    await st().restoreFor("E2E");
    expect(api.getPanel("graphics3d-2")?.title).toBe("3D Graphics 2 - Earth");
    expect(loc("timelineView")).toEqual({ type: "floating" });
    expect(api.panels).toHaveLength(6);
  });

  test("applies the default layout when the scenario has no workbook (the server answers null)", async () => {
    const { api } = await mount();
    st().newGraphicsWindow("graphics3d");
    st().openPanel("propertiesBrowser");
    stubFetch({ [url]: { text: "null" } });
    await st().restoreFor("E2E");
    expect(api.panels.map((p) => p.id).sort()).toEqual(["graphics2d", "graphics3d", "messageViewer", "objectBrowser", "timelineView"]);
    expect(warnings()).toEqual([]);
  });

  test("applies the default layout, with a warning, when the workbook is not valid", async () => {
    const { api } = await mount();
    st().openPanel("propertiesBrowser");
    stubFetch({ [url]: { json: { version: 7 } } });
    await st().restoreFor("E2E");
    expect(api.panels).toHaveLength(5);
    expect(warnings().map((m) => m.code)).toEqual(["WORKBOOK_INVALID"]);
  });

  test("applies the default layout, with a warning, when the workbook cannot be read", async () => {
    const { api } = await mount();
    st().openPanel("propertiesBrowser");
    stubFetch({ [url]: { status: 500, json: { code: "BOOM", text: "server พัง", field: null, detail: null } } });
    await st().restoreFor("E2E");
    expect(api.panels).toHaveLength(5);
    const [w] = warnings();
    expect(w).toMatchObject({ level: "warning", code: "BOOM" });
    expect(w.text).toBe(msg("workbook.loadFailed", { name: "E2E", message: "server พัง" }));
  });

  test("encodes the scenario name", async () => {
    await mount();
    const fetch = stubFetch({ "GET /api/scenarios/A%20B%2FC/workbook": { text: "null" } });
    await st().restoreFor("A B/C");
    expect(fetch.calls.map((c) => c.path)).toEqual(["/api/scenarios/A%20B%2FC/workbook"]);
  });

  test("the answer of an older call never overrides a newer one", async () => {
    const { api } = await mount();
    st().newGraphicsWindow("graphics3d");
    const withExtra = JSON.parse(JSON.stringify(st().toWorkbook())) as Workbook;
    st().applyDefault();
    const slow = deferred<{ json: unknown }>();
    stubFetch({
      "GET /api/scenarios/OLD/workbook": () => slow.promise,
      "GET /api/scenarios/NEW/workbook": { text: "null" },
    });
    const older = st().restoreFor("OLD");
    await st().restoreFor("NEW"); // ใหม่กว่า: layout ตั้งต้น
    slow.resolve({ json: withExtra });
    await older;
    expect(api.getPanel("graphics3d-2")).toBeUndefined();
    expect(api.panels).toHaveLength(5);
  });

  describe("the scenario being closed or replaced while the workbook is on its way", () => {
    /** a workbook that differs from the default layout by one more 3D window, and a request for it that the test releases */
    async function slowRestore() {
      const { api } = await mount();
      st().newGraphicsWindow("graphics3d");
      const withExtra = JSON.parse(JSON.stringify(st().toWorkbook())) as Workbook;
      st().applyDefault();
      useScenario.setState({ name: "E2E" });
      const slow = deferred<{ json: unknown }>();
      stubFetch({ [url]: () => slow.promise });
      const restoring = st().restoreFor("E2E");
      const release = async () => {
        slow.resolve({ json: withExtra });
        await restoring;
      };
      return { api, release };
    }

    test("Close: the answer is discarded, the old workbook is not applied", async () => {
      const { api, release } = await slowRestore();
      useScenario.getState().close();
      await release();
      expect(api.getPanel("graphics3d-2")).toBeUndefined();
      expect(api.panels).toHaveLength(5);
    });

    test("the scenario deleted from another tab (the SSE event closes it): the same", async () => {
      const { api, release } = await slowRestore();
      await useScenario.getState().onScenarioEvent({ name: "E2E", etag: null, results_stale: false });
      expect(useScenario.getState().name).toBeNull();
      await release();
      expect(api.getPanel("graphics3d-2")).toBeUndefined();
    });

    test("another scenario opened meanwhile: the same", async () => {
      const { api, release } = await slowRestore();
      useScenario.setState({ name: "Other" });
      await release();
      expect(api.getPanel("graphics3d-2")).toBeUndefined();
    });

    test("a failed request after the close adds no warning either", async () => {
      const { api } = await mount();
      useScenario.setState({ name: "E2E" });
      const slow = deferred<{ status: number; json: unknown }>();
      stubFetch({ [url]: () => slow.promise });
      const restoring = st().restoreFor("E2E");
      useScenario.getState().close();
      slow.resolve({ status: 500, json: { code: "BOOM", text: "server พัง" } });
      await restoring;
      expect(warnings()).toEqual([]);
      expect(api.panels).toHaveLength(5);
    });

    test("with the same scenario still open the answer is applied", async () => {
      const { api, release } = await slowRestore();
      await release();
      expect(api.getPanel("graphics3d-2")).toBeDefined();
    });
  });

  test("does nothing when the workspace is not mounted", async () => {
    const fetch = stubFetch({ [url]: { text: "null" } });
    await expect(st().restoreFor("E2E")).resolves.toBeUndefined();
    expect(fetch.calls).toEqual([]);
  });
});

describe("windows that depend on params", () => {
  const G01 = "*/Satellite/G01";
  const THBK = "*/Facility/thbk";
  const pbs = (api: DockviewApi) => api.panels.filter((p) => p.api.component === "propertiesBrowser");

  describe("Properties Browser is one window per object", () => {
    test("two different paths give two floating windows that coexist, each titled with its object", async () => {
      const { api } = await mount();
      const a = st().openPanel("propertiesBrowser", { path: G01 });
      const b = st().openPanel("propertiesBrowser", { path: THBK });
      expect(a).not.toBe(b);
      expect(pbs(api).map((p) => p.id).sort()).toEqual([a, b].sort());
      expect(api.getPanel(a)?.params).toEqual({ path: G01 });
      expect(api.getPanel(b)?.params).toEqual({ path: THBK });
      expect(api.getPanel(a)?.title).toBe("G01 Properties");
      expect(api.getPanel(b)?.title).toBe("thbk Properties");
      expect(loc(a)).toEqual({ type: "floating" });
      expect(loc(b)).toEqual({ type: "floating" });
      expect(api.activePanel?.id).toBe(b);
    });

    test("the same path twice gives one window, focused", async () => {
      const { api } = await mount();
      const first = st().openPanel("propertiesBrowser", { path: G01 });
      const other = st().openPanel("propertiesBrowser", { path: THBK });
      api.getPanel("graphics3d")!.api.setActive();
      const again = st().openPanel("propertiesBrowser", { path: G01 });
      expect(again).toBe(first);
      expect(pbs(api)).toHaveLength(2);
      expect(api.activePanel?.id).toBe(first);
      expect(st().openPanel("propertiesBrowser", { path: THBK })).toBe(other);
      expect(api.activePanel?.id).toBe(other);
    });

    test("closing one leaves the other, and the freed id is reused", async () => {
      const { api } = await mount();
      const a = st().openPanel("propertiesBrowser", { path: G01 });
      const b = st().openPanel("propertiesBrowser", { path: THBK });
      st().closePanel(a);
      expect(pbs(api).map((p) => p.id)).toEqual([b]);
      expect(st().openPanel("propertiesBrowser", { path: "*/Satellite/G02" })).toBe(a);
    });

    test("an explicit name wins over the last segment of the path; no object gives the plain title", async () => {
      const { api } = await mount();
      expect(api.getPanel(st().openPanel("propertiesBrowser", { path: G01, name: "GPS01" }))?.title).toBe("GPS01 Properties");
      expect(api.getPanel(st().openPanel("propertiesBrowser"))?.title).toBe("Properties Browser");
      expect(getPanelDef("propertiesBrowser")?.title({ path: "*" })).toBe("Properties Browser");
    });

    test("other params of a reopened window are updated", async () => {
      const { api } = await mount();
      const id = st().openPanel("propertiesBrowser", { path: G01, page: "basic" });
      expect(st().openPanel("propertiesBrowser", { path: G01, page: "graphics3d" })).toBe(id);
      expect(api.getPanel(id)?.params).toEqual({ path: G01, page: "graphics3d" });
    });
  });

  describe("every other singleton takes new params when it is reopened", () => {
    test("satelliteCatalog gets the new params and is focused", async () => {
      const { api } = await mount();
      const id = st().openPanel("satelliteCatalog", { query: "G01" });
      expect(api.getPanel(id)?.params).toEqual({ query: "G01" });
      api.getPanel("graphics3d")!.api.setActive();
      expect(st().openPanel("satelliteCatalog", { query: "R05", filter: "glonass" })).toBe(id);
      expect(api.panels.filter((p) => p.api.component === "satelliteCatalog")).toHaveLength(1);
      expect(api.getPanel(id)?.params).toEqual({ query: "R05", filter: "glonass" });
      expect(api.activePanel?.id).toBe(id);
    });

    test("the open window component receives the new params", async () => {
      const original = getPanelDef("satelliteCatalog")!;
      try {
        await mount();
        act(() => registerPanel("satelliteCatalog", { ...original, component: ({ params }) => <div>catalog query={params.query ?? "none"}</div> }));
        st().openPanel("satelliteCatalog", { query: "G01" });
        expect(await screen.findByText("catalog query=G01")).toBeDefined();
        act(() => void st().openPanel("satelliteCatalog", { query: "E11" }));
        expect(await screen.findByText("catalog query=E11")).toBeDefined();
      } finally {
        registerPanel("satelliteCatalog", original);
      }
    });

    test("reopening without params keeps the params it has", async () => {
      const { api } = await mount();
      const id = st().openPanel("satelliteCatalog", { query: "G01" });
      expect(st().openPanel("satelliteCatalog")).toBe(id);
      expect(api.getPanel(id)?.params).toEqual({ query: "G01" });
    });

    test("a docked singleton takes new params too", async () => {
      const { api } = await mount();
      expect(st().openPanel("timelineView", { focus: "G05" })).toBe("timelineView");
      expect(api.getPanel("timelineView")?.params).toEqual({ focus: "G05" });
    });
  });
});

describe("titles follow the registry and the params", () => {
  const tabText = (container: HTMLElement, id: string) => container.querySelector(`[data-tab-panel-id="${id}"] .dv-default-tab-content`)?.textContent;

  test("re-registering a kind retitles the windows of that kind that are already open", async () => {
    const original = getPanelDef("graphics3d")!;
    try {
      const { api, container } = await mount();
      st().newGraphicsWindow("graphics3d");
      act(() => registerPanel("graphics3d", { ...original, title: (p) => `Globe ${p?.n}` }));
      expect(api.getPanel("graphics3d")?.title).toBe("Globe 1");
      expect(api.getPanel("graphics3d-2")?.title).toBe("Globe 2");
      expect(tabText(container, "graphics3d-2")).toBe("Globe 2");
      expect(api.getPanel("graphics2d")?.title).toBe("2D Graphics 1 - Earth"); // other kinds are left alone
      expect(st().listWindows().find((w) => w.id === "graphics3d")?.title).toBe("Globe 1");
    } finally {
      registerPanel("graphics3d", original);
    }
    expect(apiOf().getPanel("graphics3d")?.title).toBe("3D Graphics 1 - Earth");
  });

  test("reopening a window with new params retitles it when the title depends on them", async () => {
    const { api, container } = await mount();
    const id = st().openPanel("propertiesBrowser", { path: "*/Satellite/G01", name: "G01" });
    expect(tabText(container, id)).toBe("G01 Properties");
    expect(st().openPanel("propertiesBrowser", { path: "*/Satellite/G01", name: "GPS01" })).toBe(id);
    expect(api.getPanel(id)?.title).toBe("GPS01 Properties");
    expect(tabText(container, id)).toBe("GPS01 Properties");
  });

  test("updating a window's params directly retitles it too, also after the window was moved", async () => {
    const { api } = await mount();
    const id = st().openPanel("propertiesBrowser", { path: "*/Satellite/G01" });
    api.getPanel(id)!.api.updateParameters({ name: "GPS01" });
    expect(api.getPanel(id)?.title).toBe("GPS01 Properties");
    st().setType(id, "integrated");
    st().setType(id, "dockable");
    api.getPanel(id)!.api.updateParameters({ name: "GPS02" });
    expect(api.getPanel(id)?.title).toBe("GPS02 Properties");
  });

  test("a title nobody changed is not set again (no needless layout events)", async () => {
    const { api } = await mount();
    const id = st().openPanel("propertiesBrowser", { path: "*/Satellite/G01" });
    const titleChanged = vi.fn();
    api.getPanel(id)!.api.onDidTitleChange(titleChanged);
    api.getPanel(id)!.api.updateParameters({ page: "basic" });
    act(() => registerPanel("propertiesBrowser", getPanelDef("propertiesBrowser")!));
    expect(titleChanged).not.toHaveBeenCalled();
  });

  test("after unmount the registry no longer reaches the old workspace", async () => {
    const { unmount } = await mount();
    unmount();
    expect(() => registerPanel("graphics3d", getPanelDef("graphics3d")!)).not.toThrow();
  });
});

describe("tile equalises the integrated groups", () => {
  const IDS = ["graphics3d", "graphics2d", "graphics3d-2", "graphics2d-2"];
  const size = (api: DockviewApi, id: string, axis: "width" | "height") => api.getPanel(id)!.group.api[axis];
  const sizes = (api: DockviewApi, axis: "width" | "height") => IDS.map((id) => size(api, id, axis));
  const expectEqual = (api: DockviewApi, axis: "width" | "height") => {
    const all = sizes(api, axis);
    const total = axis === "width" ? api.width : api.height;
    expect(Math.min(...all)).toBeGreaterThan(0);
    expect(Math.max(...all) - Math.min(...all)).toBeLessThanOrEqual(1);
    expect(all[0]).toBeGreaterThan(total / IDS.length - 2);
    expect(all[0]).toBeLessThan(total / IDS.length + 2);
  };

  async function fourWindows() {
    const { api } = await mount();
    act(() => api.layout(1600, 1200, true));
    st().newGraphicsWindow("graphics3d");
    st().newGraphicsWindow("graphics2d");
    return api;
  }

  test("tile(vertical) gives every group the same width", async () => {
    const api = await fourWindows();
    st().tile("horizontal"); // อยู่แบบซ้อนกันอยู่ก่อน
    st().tile("vertical");
    expectEqual(api, "width");
    for (const id of IDS) expect(size(api, id, "height")).toBe(api.height);
  });

  test("tile(horizontal) gives every group the same height", async () => {
    const api = await fourWindows();
    st().tile("horizontal");
    expectEqual(api, "height");
    for (const id of IDS) expect(size(api, id, "width")).toBe(api.width);
  });

  test("groups the user had dragged to different sizes are evened out", async () => {
    const api = await fourWindows();
    st().tile("horizontal");
    api.getPanel("graphics3d")!.group.api.setSize({ height: 100 });
    expect(Math.max(...sizes(api, "height")) - Math.min(...sizes(api, "height"))).toBeGreaterThan(50);
    st().tile("horizontal");
    expectEqual(api, "height");
  });

  test("windows that were tabbed together end up equal as well", async () => {
    const api = await fourWindows();
    st().cascade();
    st().tile("vertical");
    expectEqual(api, "width");
  });
});

describe("window titles", () => {
  test("a title-only change bumps the revision, so lists of windows (Window menu, Windows... dialog) re-read the titles", async () => {
    const { api } = await mount();
    const before = st().revision;
    api.getPanel("messageViewer")!.api.setTitle("Renamed Viewer");
    expect(st().revision).toBeGreaterThan(before);
    expect(st().listWindows().find((w) => w.id === "messageViewer")?.title).toBe("Renamed Viewer");
  });

  test("a window added after attach is watched too", async () => {
    const { api } = await mount();
    const id = st().openPanel("propertiesBrowser", { path: "*/Satellite/G01" });
    const before = st().revision;
    api.getPanel(id)!.api.setTitle("Other");
    expect(st().revision).toBeGreaterThan(before);
  });
});
