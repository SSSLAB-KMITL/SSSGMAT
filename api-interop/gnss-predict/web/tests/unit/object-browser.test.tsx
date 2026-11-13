import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "../../src/api/client";
import { Dialogs } from "../../src/chrome/Dialogs";
import { invalidateCommands, isEnabled, isRegistered, registerCommand, runCommand } from "../../src/commands";
import { t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { getPanelDef } from "../../src/layout/panels";
import { installShortcuts } from "../../src/shortcuts";
import { useLayout } from "../../src/stores/layout";
import { useMessages } from "../../src/stores/messages";
import { useResults } from "../../src/stores/results";
import { useScenario, type TreeNode, type TreeObject } from "../../src/stores/scenario";
import { useSelection } from "../../src/stores/selection";
import { useClipboard } from "../../src/windows/ObjectBrowser/clipboard";
import { ObjectBrowser, registerObjectBrowserPanel } from "../../src/windows/ObjectBrowser/ObjectBrowser";
import { registerObjectBrowserCommands } from "../../src/windows/ObjectBrowser/objectCommands";
import { useObjectBrowser } from "../../src/windows/ObjectBrowser/state";
import { resetAll } from "./helpers/chrome";
import { deferred, stubFetch } from "./helpers/fake-fetch";
import { CATALOG, SENSOR_COLOR, entry, loadObjects, loadSensors, makeScenarioDoc, makeTree, satPath, sensorPath } from "./helpers/objects";

const written = { stale: false };
const spies = {
  patchObject: vi.fn(async () => written),
  insert: vi.fn(async () => [] as string[]),
  rename: vi.fn(async () => written),
  remove: vi.fn(async () => written),
  setGroup: vi.fn(async () => written),
};
const openPanel = vi.fn(() => "propertiesBrowser");

let user: ReturnType<typeof userEvent.setup>;
let stopShortcuts: (() => void) | undefined;
let disposeCommands: () => void;

beforeEach(() => {
  resetAll();
  useClipboard.setState(useClipboard.getInitialState(), true);
  for (const spy of Object.values(spies)) spy.mockClear();
  openPanel.mockClear();
  useScenario.setState(spies as never);
  useLayout.setState({ openPanel } as never);
  disposeCommands = registerObjectBrowserCommands(); // registered once at app start (App.tsx), not by the window
  user = userEvent.setup();
});
afterEach(() => {
  disposeCommands();
  stopShortcuts?.();
  stopShortcuts = undefined;
  cleanup();
  vi.unstubAllGlobals();
});

function renderOb() {
  return render(
    <>
      <ObjectBrowser params={{}} panelId="objectBrowser" />
      <Dialogs />
    </>,
  );
}
// aria-hidden while a modal (context menu, dialog) is open: the rows are still there
const treeitems = () => screen.getAllByRole("treeitem", { hidden: true });
const names = () => treeitems().map((r) => r.textContent);
const row = (name: string): HTMLElement => {
  const el = screen.queryAllByRole("treeitem", { hidden: true }).find((r) => r.textContent === name);
  if (el === undefined) throw new Error(`no row named ${name}; rows: ${names().join(", ")}`);
  return el;
};
const hasRow = (name: string) => screen.queryAllByRole("treeitem", { hidden: true }).some((r) => r.textContent === name);
const checkbox = (name: string) => within(row(name)).getByRole("checkbox");
const swatch = (name: string) => within(row(name)).getByRole("img", { name: new RegExp(t("field.color")) });
const colorInput = (name: string) => row(name).querySelector<HTMLInputElement>('input[type="color"]')!;
const button = (name: string) => screen.getByRole("button", { name });
const selected = () => screen.queryAllByRole("treeitem", { hidden: true }).filter((r) => r.getAttribute("aria-selected") === "true").map((r) => r.textContent);
const item = (menu: HTMLElement, name: string) => within(menu).getByRole("menuitem", { name });

/** what the real store does before rename() / remove() resolve: the doc and the tree are reloaded (rows are keyed by path) */
function renameInStore(oldName: string, newName: string): void {
  const swap = (path: string) => (path === satPath(oldName) ? satPath(newName) : path);
  const { doc, tree } = useScenario.getState();
  const nextDoc = structuredClone(doc!);
  for (const o of nextDoc.objects as { name: string; assigned_objects?: string[] }[]) {
    if (o.name === oldName) o.name = newName;
    if (o.assigned_objects) o.assigned_objects = o.assigned_objects.map(swap);
  }
  for (const g of nextDoc.groups ?? []) g.members = (g.members ?? []).map(swap);
  const rename = (n: TreeNode): TreeNode => ("group" in n ? { ...n, children: n.children.map((c) => rename(c) as TreeObject) } : n.name === oldName ? { ...n, name: newName, path: swap(n.path) } : n);
  useScenario.setState({ doc: nextDoc, tree: { ...tree!, children: tree!.children.map(rename) } });
}

function removeFromStore(name: string): void {
  const { doc, tree } = useScenario.getState();
  const nextDoc = structuredClone(doc!);
  nextDoc.objects = nextDoc.objects.filter((o) => o.name !== name);
  const keep = (n: TreeNode): TreeNode[] => ("group" in n ? [{ ...n, children: n.children.filter((c) => c.name !== name) }] : n.name === name ? [] : [n]);
  useScenario.setState({ doc: nextDoc, tree: { ...tree!, children: tree!.children.flatMap(keep) } });
}

/** let the dialog's own close steps (Radix runs them in a timeout) finish */
const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));

describe("rows", () => {
  test("shows the scenario, the Facility, the Constellation, the folders with their members and the ungrouped satellites", () => {
    loadObjects();
    renderOb();
    expect(names()).toEqual(["S1", "THBK", "GPS", "GPS sats", "G01", "G02", "Mine", "G03", "G04", "G05"]);
    expect(screen.getByRole("tree", { name: t("window.objectBrowser") })).toBeDefined();
    expect(row("G01").getAttribute("aria-level")).toBe("3");
    expect(row("S1").getAttribute("aria-expanded")).toBe("true");
    expect(row("G01").getAttribute("aria-expanded")).toBeNull();
  });

  test("the root element is the Object Browser focus scope that the shortcuts look for", () => {
    loadObjects();
    const { container } = renderOb();
    expect(container.querySelector('[data-focus-scope="objectBrowser"]')).not.toBeNull();
    expect(container.querySelector('[data-focus-scope="objectBrowser"]')!.contains(row("G01"))).toBe(true);
  });

  test("an object row has an arrow slot, a checkbox, a colour box, an icon and the name; a folder has only the arrow, the icon and the name", () => {
    loadObjects();
    renderOb();
    expect(checkbox("G01").hasAttribute("checked") || (checkbox("G01") as HTMLInputElement).checked).toBe(true);
    expect(swatch("G01").style.background).toMatch(/rgb\(255, 210, 63\)|#ffd23f/i);
    expect(row("G01").querySelector("svg")).not.toBeNull();
    expect(within(row("GPS sats")).queryByRole("checkbox")).toBeNull();
    expect(row("GPS sats").querySelector('input[type="color"]')).toBeNull();
    expect(within(row("GPS sats")).queryByRole("img", { name: new RegExp(t("field.color")) })).toBeNull();
    expect(row("GPS sats").querySelector("svg")).not.toBeNull();
  });

  test("the root row has no checkbox or colour box either", () => {
    loadObjects();
    renderOb();
    expect(within(row("S1")).queryByRole("checkbox")).toBeNull();
    expect(row("S1").querySelector('input[type="color"]')).toBeNull();
  });

  test("a satellite hidden by a flag is italic and dim, and its checkbox is disabled", () => {
    loadObjects();
    renderOb();
    expect(row("G03").classList.contains("ob-hidden")).toBe(true);
    expect((checkbox("G03") as HTMLInputElement).disabled).toBe(true);
    expect(row("G04").classList.contains("ob-hidden")).toBe(false);
    expect((checkbox("G04") as HTMLInputElement).disabled).toBe(false);
  });

  test("the theme makes a hidden row italic, and its Object Browser rules use tokens only", () => {
    const css = readFileSync(resolve(__dirname, "../../src/theme.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
    const ob = rules.filter((r) => /(^|[\s,>])\.ob[\s.:[,{-]|\.ob$|\.ob-/.test(r.selector));
    expect(ob.length).toBeGreaterThan(5);
    expect(ob.find((r) => r.selector === ".ob-hidden")?.body).toContain("font-style: italic");
    for (const r of ob) expect(r.body, r.selector).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  test("a warning sign shows for a stale satellite but not for one with only name_mismatch", () => {
    loadObjects();
    renderOb();
    const warn = (name: string) => within(row(name)).queryByRole("img", { name: t("status.flaggedSatellites") });
    expect(warn("G04")).not.toBeNull();
    expect(warn("G05")).toBeNull();
    expect(warn("G01")).toBeNull();
  });

  test("hovering a satellite shows its tooltip: PRN, SVN, NORAD, Block, CelesTrak name, age and the flags in Thai", async () => {
    loadObjects();
    renderOb();
    await user.hover(row("G04"));
    const tip = (await screen.findByRole("tooltip")).textContent ?? "";
    for (const part of [`${t("field.prn")}: G04`, `${t("field.svn")}: G64`, `${t("field.norad")}: 40104`, `${t("field.block")}: IIF`,
                        `${t("field.celestrakName")}: GPS BIIF-4  (PRN 4)`, `${t("field.dataAge")}: 3.0 d`, msg("flag.stale")]) {
      expect(tip, part).toContain(part);
    }
  });

  test("a Facility gets a simple tooltip", async () => {
    loadObjects();
    renderOb();
    await user.hover(row("THBK"));
    expect((await screen.findByRole("tooltip")).textContent).toBe(`${t("ob.class.facility")}: THBK`);
  });

  test("shows a Thai note instead of a tree while no scenario is open", () => {
    renderOb();
    expect(screen.getByText(msg("tooltip.noScenario"))).toBeDefined();
    expect(screen.queryAllByRole("treeitem")).toEqual([]);
  });
});

describe("sensors", () => {
  // G01 is inside the "GPS sats" folder, G04 is loose
  const SENSORS = { G01: ["Sensor1", "Sensor2"], G04: ["Nav1"] };
  const iconClass = (name: string) => row(name).querySelector("svg.ob-icon")?.getAttribute("class") ?? "";

  test("sensor rows sit one level under their satellite; the satellite has an arrow, the sensor has none", () => {
    loadSensors(SENSORS);
    renderOb();
    expect(names()).toEqual(["S1", "THBK", "GPS", "GPS sats", "G01", "Sensor1", "Sensor2", "G02", "Mine", "G03", "G04", "Nav1", "G05"]);
    expect(row("Sensor1").getAttribute("aria-level")).toBe("4");
    expect(row("Nav1").getAttribute("aria-level")).toBe("3");
    expect(row("G01").getAttribute("aria-expanded")).toBe("true");
    expect(row("Sensor1").getAttribute("aria-expanded")).toBeNull();
    expect(row("G02").getAttribute("aria-expanded")).toBeNull(); // no sensors: nothing to open
    expect(row("Sensor1").querySelector("svg.ob-arrow, .ob-arrow svg")).toBeNull();
    expect(row("G01").querySelector(".ob-arrow svg")).not.toBeNull();
  });

  test("a sensor row has a checkbox, a colour box in the colour of the sensor and an icon of its own", () => {
    loadSensors(SENSORS);
    renderOb();
    expect((checkbox("Sensor1") as HTMLInputElement).checked).toBe(true);
    expect(swatch("Sensor1").style.background).toMatch(/rgb\(232, 197, 71\)|#e8c547/i);
    expect(colorInput("Sensor1").defaultValue).toBe(SENSOR_COLOR);
    expect(iconClass("Sensor1")).not.toBe("");
    expect(iconClass("Sensor1")).not.toBe(iconClass("G01"));
    expect(iconClass("Sensor1")).not.toBe(iconClass("THBK"));
    expect(iconClass("Sensor1")).not.toBe(iconClass("GPS"));
    expect(iconClass("Sensor1")).toBe(iconClass("Nav1")); // one icon for the class
  });

  test("hovering a sensor shows its class and name", async () => {
    loadSensors(SENSORS);
    renderOb();
    await user.hover(row("Sensor1"));
    expect((await screen.findByRole("tooltip")).textContent).toBe(`${t("ob.class.sensor")}: Sensor1`);
  });

  test("the arrow of a satellite hides and shows its sensors", async () => {
    loadSensors(SENSORS);
    renderOb();
    await user.click(row("G01").querySelector(".ob-arrow")!);
    expect(hasRow("Sensor1")).toBe(false);
    expect(hasRow("Sensor2")).toBe(false);
    expect(hasRow("Nav1")).toBe(true);
    expect(row("G01").getAttribute("aria-expanded")).toBe("false");
    await user.click(row("G01").querySelector(".ob-arrow")!);
    expect(hasRow("Sensor1")).toBe(true);
  });

  test("Collapse All folds the satellites too, and Expand All brings the sensors back", async () => {
    loadSensors(SENSORS);
    renderOb();
    await user.click(button(t("ob.collapseAll")));
    expect(names()).toEqual(["S1", "THBK", "GPS", "GPS sats", "Mine", "G03", "G04", "G05"]);
    expect(row("G04").getAttribute("aria-expanded")).toBe("false");
    await user.click(button(t("ob.expandAll")));
    expect(names()).toContain("Nav1");
    expect(names()).toContain("Sensor2");
  });

  test("ArrowRight opens a closed satellite and then goes to its first sensor; ArrowLeft climbs back to the satellite and then closes it", async () => {
    loadSensors(SENSORS);
    renderOb();
    await user.click(row("G04"));
    await user.keyboard("{ArrowLeft}");
    expect(hasRow("Nav1")).toBe(false);
    expect(selected()).toEqual(["G04"]);
    await user.keyboard("{ArrowRight}");
    expect(hasRow("Nav1")).toBe(true);
    expect(selected()).toEqual(["G04"]);
    await user.keyboard("{ArrowRight}");
    expect(selected()).toEqual(["Nav1"]);
    await user.keyboard("{ArrowRight}");
    expect(selected()).toEqual(["Nav1"]); // a sensor has nothing below it
    await user.keyboard("{ArrowLeft}");
    expect(selected()).toEqual(["G04"]);
  });

  test("clicking a sensor makes it the active object", async () => {
    loadSensors(SENSORS);
    renderOb();
    await user.click(row("Sensor2"));
    expect(useSelection.getState().activePath).toBe(sensorPath("Sensor2"));
    expect(selected()).toEqual(["Sensor2"]);
  });

  test("selecting a sensor from elsewhere opens the satellite that was folded", async () => {
    loadSensors(SENSORS);
    renderOb();
    await user.click(row("G04").querySelector(".ob-arrow")!);
    expect(hasRow("Nav1")).toBe(false);
    act(() => useSelection.getState().select(sensorPath("Nav1")));
    expect(hasRow("Nav1")).toBe(true);
    expect(selected()).toEqual(["Nav1"]);
  });

  test("double-click opens the Properties Browser of the sensor", async () => {
    loadSensors(SENSORS);
    renderOb();
    await user.dblClick(row("Sensor1"));
    expect(openPanel).toHaveBeenCalledWith("propertiesBrowser", { path: sensorPath("Sensor1"), name: "Sensor1" });
  });

  test("the Show checkbox PATCHes graphics2d.show and graphics3d.show of that Sensor", async () => {
    loadSensors(SENSORS);
    renderOb();
    await user.click(checkbox("Sensor1"));
    expect(spies.patchObject).toHaveBeenCalledTimes(1);
    expect(spies.patchObject).toHaveBeenCalledWith("Sensor", "Sensor1", { graphics2d: { show: false }, graphics3d: { show: false } });
  });

  test("the colour box PATCHes graphics2d.color and graphics3d.color of the Sensor (it has a colour on each page, and no inherit)", () => {
    loadSensors(SENSORS);
    renderOb();
    fireEvent.change(colorInput("Nav1"), { target: { value: "#00ff00" } });
    expect(spies.patchObject).toHaveBeenCalledTimes(1);
    expect(spies.patchObject).toHaveBeenCalledWith("Sensor", "Nav1", { graphics2d: { color: "#00ff00" }, graphics3d: { color: "#00ff00" } });
  });

  test("the colour box of a satellite and of a Facility still writes graphics2d only", () => {
    loadSensors(SENSORS);
    renderOb();
    fireEvent.change(colorInput("G01"), { target: { value: "#00ff00" } });
    fireEvent.change(colorInput("THBK"), { target: { value: "#123456" } });
    expect(spies.patchObject.mock.calls).toEqual([
      ["Satellite", "G01", { graphics2d: { color: "#00ff00", inherit: false } }],
      ["Facility", "THBK", { graphics2d: { color: "#123456", inherit: false } }],
    ]);
  });

  test("the colour box follows the colour in the scenario", () => {
    const doc = makeScenarioDoc({}, SENSORS);
    (doc.objects.find((o) => o.name === "Sensor2") as { graphics2d: { color: string } }).graphics2d.color = "#112233";
    loadObjects({ tree: makeTree({ sensors: SENSORS }), doc });
    renderOb();
    expect(swatch("Sensor2").style.background).toMatch(/rgb\(17, 34, 51\)|#112233/i);
    expect(swatch("Sensor1").style.background).toMatch(/rgb\(232, 197, 71\)|#e8c547/i);
  });

  test("Delete asks first, then removes the Sensor and moves the selection to the next row", async () => {
    loadSensors(SENSORS);
    renderOb();
    await user.click(row("Sensor1"));
    await user.click(button(t("ob.delete")));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(msg("confirm.delete", { name: "Sensor1" }))).toBeDefined();
    expect(spies.remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(spies.remove).toHaveBeenCalledWith("Sensor", "Sensor1"));
    await waitFor(() => expect(useSelection.getState().activePath).toBe(sensorPath("Sensor2")));
  });

  test("deleting a satellite that has sensors moves the selection past its sensors (they go with it), to the next satellite", async () => {
    loadSensors(SENSORS);
    renderOb();
    await user.click(row("G01"));
    await user.click(button(t("ob.delete")));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(spies.remove).toHaveBeenCalledWith("Satellite", "G01"));
    await waitFor(() => expect(useSelection.getState().activePath).toBe(satPath("G02")));
  });

  test("deleting the last satellite of the tree, with sensors, moves the selection to the row before it", async () => {
    loadSensors({ G05: ["Sensor1"] });
    renderOb();
    await user.click(row("G05"));
    await user.click(button(t("ob.delete")));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(spies.remove).toHaveBeenCalledWith("Satellite", "G05"));
    await waitFor(() => expect(useSelection.getState().activePath).toBe(satPath("G04")));
  });

  test("Rename renames the Sensor", async () => {
    loadSensors(SENSORS);
    renderOb();
    await user.click(row("Nav1"));
    act(() => runCommand("object.rename"));
    const dialog = await screen.findByRole("dialog", { name: t("menu.object.rename") });
    const field = within(dialog).getByRole("textbox", { name: t("field.name") }) as HTMLInputElement;
    expect(field.value).toBe("Nav1");
    await user.clear(field);
    await user.type(field, "Cam");
    await user.click(within(dialog).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(spies.rename).toHaveBeenCalledWith("Sensor", "Nav1", "Cam"));
    await waitFor(() => expect(useSelection.getState().activePath).toBe(sensorPath("Cam")));
  });

  test("Cut and Copy are disabled on a sensor and say in Thai that sensors cannot be copied yet", async () => {
    loadSensors(SENSORS);
    renderOb();
    await user.click(row("Sensor1"));
    const { commandTooltip } = await import("../../src/commands");
    for (const id of ["edit.cut", "edit.copy"] as const) {
      expect(isEnabled(id), id).toBe(false);
      expect(commandTooltip(id), id).toBe(msg("ob.sensorCopyUnsupported"));
    }
    expect(button(t("ob.copy")).getAttribute("aria-disabled")).toBe("true");
    await user.click(row("G01")); // the satellite still copies
    expect(isEnabled("edit.copy")).toBe(true);
  });

  test("a sensor can be found by name; Find opens the folded satellite above it", async () => {
    loadSensors(SENSORS);
    renderOb();
    await user.click(row("G04").querySelector(".ob-arrow")!);
    act(() => runCommand("edit.find"));
    await user.type(await screen.findByRole("textbox"), "nav");
    await user.click(screen.getByRole("button", { name: t("ob.findNext") }));
    expect(selected()).toEqual(["Nav1"]);
  });
});

describe("selection", () => {
  test("clicking a row selects it and sets the active object", async () => {
    loadObjects();
    renderOb();
    await user.click(row("G01"));
    expect(useSelection.getState().activePath).toBe(satPath("G01"));
    expect(selected()).toEqual(["G01"]);
    expect(document.activeElement).toBe(row("G01"));
  });

  test("a selection made elsewhere highlights the row", () => {
    loadObjects();
    renderOb();
    act(() => useSelection.getState().select(satPath("G02")));
    expect(selected()).toEqual(["G02"]);
    act(() => useSelection.getState().select("*/Facility/THBK"));
    expect(selected()).toEqual(["THBK"]);
  });

  test("a folder can be selected, and it leaves no active object", async () => {
    loadObjects();
    renderOb();
    await user.click(row("G01"));
    await user.click(row("Mine"));
    expect(selected()).toEqual(["Mine"]);
    expect(useSelection.getState().activePath).toBeNull();
    await user.click(row("G02"));
    expect(selected()).toEqual(["G02"]);
  });

  test("a selection inside a collapsed folder opens the folder", () => {
    loadObjects();
    renderOb();
    fireEvent.doubleClick(row("GPS sats"));
    expect(hasRow("G01")).toBe(false);
    act(() => useSelection.getState().select(satPath("G01")));
    expect(hasRow("G01")).toBe(true);
    expect(selected()).toEqual(["G01"]);
  });
});

describe("expansion", () => {
  test("everything starts expanded; the arrow collapses and expands a folder", async () => {
    loadObjects();
    renderOb();
    expect(hasRow("G01")).toBe(true);
    await user.click(row("GPS sats").querySelector(".ob-arrow")!);
    expect(hasRow("G01")).toBe(false);
    expect(row("GPS sats").getAttribute("aria-expanded")).toBe("false");
    await user.click(row("GPS sats").querySelector(".ob-arrow")!);
    expect(hasRow("G01")).toBe(true);
  });

  test("double-clicking a folder toggles it and does not open Properties", async () => {
    loadObjects();
    renderOb();
    await user.dblClick(row("GPS sats"));
    expect(hasRow("G01")).toBe(false);
    expect(openPanel).not.toHaveBeenCalled();
  });

  test("Collapse All folds every folder but keeps the scenario open; Expand All opens everything", async () => {
    loadObjects();
    renderOb();
    await user.click(button(t("ob.collapseAll")));
    expect(names()).toEqual(["S1", "THBK", "GPS", "GPS sats", "Mine", "G03", "G04", "G05"]);
    expect(row("GPS sats").getAttribute("aria-expanded")).toBe("false");
    await user.click(button(t("ob.expandAll")));
    expect(names()).toEqual(["S1", "THBK", "GPS", "GPS sats", "G01", "G02", "Mine", "G03", "G04", "G05"]);
  });
});

describe("another scenario", () => {
  test("starts expanded again with no filter and no folder selected, but keeps the column choices", async () => {
    loadObjects();
    renderOb();
    await user.dblClick(row("GPS sats"));
    await user.click(row("Mine"));
    act(() => runCommand("ob.showFlagged"));
    act(() => runCommand("ob.onOffToggles"));
    expect(names()).toEqual(["S1", "G03", "G04"]);
    act(() => useScenario.setState({ name: "S2" }));
    expect(names()).toEqual(["S1", "THBK", "GPS", "GPS sats", "G01", "G02", "Mine", "G03", "G04", "G05"]);
    expect(selected()).toEqual([]);
    expect(within(row("G01")).queryByRole("checkbox")).toBeNull();
  });
});

describe("Show checkbox", () => {
  test("a satellite: PATCHes graphics2d.show and graphics3d.show", async () => {
    loadObjects();
    renderOb();
    await user.click(checkbox("G01"));
    expect(spies.patchObject).toHaveBeenCalledTimes(1);
    expect(spies.patchObject).toHaveBeenCalledWith("Satellite", "G01", { graphics2d: { show: false }, graphics3d: { show: false } });
  });

  test("a Facility: the same two pages", async () => {
    loadObjects();
    renderOb();
    await user.click(checkbox("THBK"));
    expect(spies.patchObject).toHaveBeenCalledWith("Facility", "THBK", { graphics2d: { show: false }, graphics3d: { show: false } });
  });

  test("turning an unchecked box on sends show true", async () => {
    const tree = makeTree();
    (tree.children[4] as { children: { show: boolean }[] }).children = [];
    (tree.children[2] as { children: { show: boolean }[] }).children[0].show = false;
    loadObjects({ tree });
    renderOb();
    expect((checkbox("G01") as HTMLInputElement).checked).toBe(false);
    await user.click(checkbox("G01"));
    expect(spies.patchObject).toHaveBeenCalledWith("Satellite", "G01", { graphics2d: { show: true }, graphics3d: { show: true } });
  });

  test("a Constellation: one PATCH per member satellite, one after the other", async () => {
    loadObjects();
    renderOb();
    const first = deferred<{ stale: boolean }>();
    spies.patchObject.mockImplementationOnce(() => first.promise);
    await user.click(checkbox("GPS"));
    expect(spies.patchObject.mock.calls.map((c) => c.slice(0, 2))).toEqual([["Satellite", "G01"]]);
    await act(async () => first.resolve(written));
    await waitFor(() => expect(spies.patchObject).toHaveBeenCalledTimes(2));
    expect(spies.patchObject.mock.calls).toEqual([
      ["Satellite", "G01", { graphics2d: { show: false }, graphics3d: { show: false } }],
      ["Satellite", "G02", { graphics2d: { show: false }, graphics3d: { show: false } }],
    ]);
  });

  test("a Constellation stops at the first member that fails", async () => {
    loadObjects();
    renderOb();
    spies.patchObject.mockRejectedValueOnce(new ApiError({ status: 422, code: "SCENARIO_INVALID", text: "ไม่ได้" }));
    await user.click(checkbox("GPS"));
    await waitFor(() => expect(useMessages.getState().items.some((m) => m.code === "SCENARIO_INVALID")).toBe(true));
    expect(spies.patchObject).toHaveBeenCalledTimes(1);
  });

  test("a hidden satellite cannot be toggled", async () => {
    loadObjects();
    renderOb();
    await user.click(checkbox("G03"));
    expect(spies.patchObject).not.toHaveBeenCalled();
  });

  test("a failed write is reported in the Message Viewer with the server text", async () => {
    loadObjects();
    renderOb();
    spies.patchObject.mockRejectedValueOnce(new ApiError({ status: 422, code: "SCENARIO_INVALID", text: "ค่าผิด" }));
    await user.click(checkbox("G01"));
    await waitFor(() => expect(useMessages.getState().items.map((m) => m.text)).toContain("ค่าผิด"));
  });

  test("a 412 is left to the conflict dialog and is not reported twice", async () => {
    loadObjects();
    renderOb();
    spies.patchObject.mockRejectedValueOnce(new ApiError({ status: 412, code: "PRECONDITION_FAILED", text: "stale" }));
    await user.click(checkbox("G01"));
    await new Promise((r) => setTimeout(r, 20));
    expect(useMessages.getState().items.some((m) => m.code === "PRECONDITION_FAILED")).toBe(false);
  });

  test("the checkbox of a row is disabled while its write runs, and a second click does not write again", async () => {
    loadObjects();
    renderOb();
    const pending = deferred<{ stale: boolean }>();
    spies.patchObject.mockImplementationOnce(() => pending.promise);
    await user.click(checkbox("G01"));
    await waitFor(() => expect((checkbox("G01") as HTMLInputElement).disabled).toBe(true));
    await user.click(checkbox("G01"));
    expect(spies.patchObject).toHaveBeenCalledTimes(1);
    expect((checkbox("G02") as HTMLInputElement).disabled).toBe(false); // other rows stay usable
    await act(async () => pending.resolve(written));
    await waitFor(() => expect((checkbox("G01") as HTMLInputElement).disabled).toBe(false));
  });

  test("it is enabled again after a failed write", async () => {
    loadObjects();
    renderOb();
    spies.patchObject.mockRejectedValueOnce(new ApiError({ status: 422, code: "SCENARIO_INVALID", text: "ค่าผิด" }));
    await user.click(checkbox("G01"));
    await waitFor(() => expect(useMessages.getState().items.some((m) => m.code === "SCENARIO_INVALID")).toBe(true));
    expect((checkbox("G01") as HTMLInputElement).disabled).toBe(false);
  });

  test("Space held down toggles once, and Space again while the write runs does nothing", async () => {
    loadObjects();
    renderOb();
    await user.click(row("G04"));
    const pending = deferred<{ stale: boolean }>();
    spies.patchObject.mockImplementationOnce(() => pending.promise);
    fireEvent.keyDown(row("G04"), { key: " " });
    fireEvent.keyDown(row("G04"), { key: " ", repeat: true });
    fireEvent.keyDown(row("G04"), { key: " ", repeat: true });
    expect(spies.patchObject).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(row("G04"), { key: " " }); // a fresh press while the first write is still running
    expect(spies.patchObject).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(written));
    await waitFor(() => expect((checkbox("G04") as HTMLInputElement).disabled).toBe(false));
    fireEvent.keyDown(row("G04"), { key: " ", repeat: true }); // the key is still held after the write finished
    expect(spies.patchObject).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(row("G04"), { key: " " });
    expect(spies.patchObject).toHaveBeenCalledTimes(2);
  });

  test("a Constellation writes each member with that member's own class", async () => {
    const doc = makeScenarioDoc();
    const gps = (doc.objects as { class: string; name: string; assigned_objects?: string[] }[]).find((o) => o.name === "GPS")!;
    gps.assigned_objects = [satPath("G01"), "*/Facility/THBK", "*/Constellation/Other"];
    (doc.objects as unknown[]).push({ class: "Constellation", name: "Other", system: "R", assigned_objects: [] });
    const tree = makeTree();
    tree.children.splice(2, 0, { path: "*/Constellation/Other", class: "Constellation", name: "Other", color: "#ff6b6b", show: true });
    loadObjects({ doc, tree });
    renderOb();
    await user.click(checkbox("GPS"));
    await waitFor(() => expect(spies.patchObject).toHaveBeenCalledTimes(2));
    expect(spies.patchObject.mock.calls).toEqual([
      ["Satellite", "G01", { graphics2d: { show: false }, graphics3d: { show: false } }],
      ["Facility", "THBK", { graphics2d: { show: false }, graphics3d: { show: false } }], // a nested Constellation has no graphics pages and is left alone
    ]);
  });

  test("clicking the checkbox selects its row", async () => {
    loadObjects();
    renderOb();
    await user.click(checkbox("G02"));
    expect(selected()).toEqual(["G02"]);
  });
});

describe("colour box", () => {
  test("double-click opens the native colour input, and choosing a colour PATCHes graphics2d.color with inherit false", () => {
    loadObjects();
    renderOb();
    const input = colorInput("G01");
    expect(input.type).toBe("color");
    const click = vi.spyOn(input, "click");
    fireEvent.doubleClick(swatch("G01"));
    expect(click).toHaveBeenCalled();
    expect(openPanel).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "#00ff00" } });
    expect(spies.patchObject).toHaveBeenCalledWith("Satellite", "G01", { graphics2d: { color: "#00ff00", inherit: false } });
  });

  test("a Facility PATCHes its graphics2d the same way", () => {
    loadObjects();
    renderOb();
    fireEvent.change(colorInput("THBK"), { target: { value: "#123456" } });
    expect(spies.patchObject).toHaveBeenCalledWith("Facility", "THBK", { graphics2d: { color: "#123456", inherit: false } });
  });

  test("a Constellation PATCHes its own basic.color", () => {
    loadObjects();
    renderOb();
    fireEvent.change(colorInput("GPS"), { target: { value: "#abcdef" } });
    expect(spies.patchObject).toHaveBeenCalledWith("Constellation", "GPS", { basic: { color: "#abcdef" } });
  });

  test("the box shows the colour the object is drawn with (here the same as the tree), and the input starts from it", () => {
    loadObjects();
    renderOb();
    expect(colorInput("THBK").value).toBe("#ff79e6");
  });

  test("a copy that inherits shows the colour it is drawn with, and follows the results when they arrive", () => {
    const doc = makeScenarioDoc();
    (doc.objects as unknown[]).push({ class: "Satellite", name: "C19_1", norad: 44199, graphics2d: { inherit: true, color: "#cccccc" } });
    const tree = makeTree({ loose: ["G03", "G04", "G05", "C19_1"] });
    for (const node of tree.children) if ("path" in node && node.name === "C19_1") node.color = "#cccccc";
    loadObjects({ doc, tree });
    renderOb();
    expect(swatch("C19_1").getAttribute("aria-label")).toBe(`${t("field.color")}: #c8c8c8`); // not in the catalog: system unknown yet
    act(() => useResults.setState({ prnByNorad: new Map([[44199, "C19"]]) }));
    expect(swatch("C19_1").getAttribute("aria-label")).toBe(`${t("field.color")}: #45c8ff`); // BeiDou, as the 3D and 2D windows draw it
    fireEvent.doubleClick(swatch("C19_1"));
    expect(colorInput("C19_1").value).toBe("#45c8ff"); // the picker opens on the colour shown
    fireEvent.change(colorInput("C19_1"), { target: { value: "#45c8ff" } });
    expect(spies.patchObject).not.toHaveBeenCalled(); // choosing the colour it is drawn with changes nothing
  });

  test("picking the colour it already has does nothing", () => {
    loadObjects();
    renderOb();
    fireEvent.change(colorInput("G01"), { target: { value: "#ffd23f" } });
    expect(spies.patchObject).not.toHaveBeenCalled();
  });
});

describe("Properties", () => {
  test("double-click opens the Properties Browser of that object", async () => {
    loadObjects();
    renderOb();
    await user.dblClick(row("G01"));
    expect(openPanel).toHaveBeenCalledWith("propertiesBrowser", { path: satPath("G01"), name: "G01" });
  });

  test("the scenario row opens the Scenario's Properties", async () => {
    loadObjects();
    renderOb();
    await user.dblClick(row("S1"));
    expect(openPanel).toHaveBeenCalledWith("propertiesBrowser", { path: "*", name: "S1" });
  });

  test("the toolbar button and Enter open the selected object; a folder cannot be opened", async () => {
    loadObjects();
    renderOb();
    expect(button(t("ob.properties")).getAttribute("aria-disabled")).toBe("true");
    await user.click(row("THBK"));
    expect(button(t("ob.properties")).getAttribute("aria-disabled")).toBeNull();
    await user.click(button(t("ob.properties")));
    expect(openPanel).toHaveBeenLastCalledWith("propertiesBrowser", { path: "*/Facility/THBK", name: "THBK" });
    await user.click(row("Mine"));
    expect(button(t("ob.properties")).getAttribute("aria-disabled")).toBe("true");
    openPanel.mockClear();
    await user.keyboard("{Enter}");
    expect(openPanel).not.toHaveBeenCalled();
  });
});

describe("context menu", () => {
  test("right-click selects the row and lists Properties, Access..., Report & Graph Manager..., Zoom To, Rename, Delete", async () => {
    loadObjects();
    renderOb();
    await user.pointer({ keys: "[MouseRight]", target: row("G01") });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "Properties", "Access...", "Report & Graph Manager...", "Zoom To", "Rename", "Delete",
    ]);
    expect(selected()).toEqual(["G01"]);
    expect(item(menu, "Properties").getAttribute("aria-disabled")).toBeNull();
    expect(item(menu, "Rename").getAttribute("aria-disabled")).toBeNull();
    expect(item(menu, "Delete").getAttribute("aria-disabled")).toBeNull();
    expect(item(menu, "Access...").getAttribute("aria-disabled")).toBe("true");
  });

  test("right-click on a sensor selects it and lists Properties, Access..., Zoom To, Rename, Delete", async () => {
    loadSensors({ G01: ["Sensor1"] });
    renderOb();
    await user.pointer({ keys: "[MouseRight]", target: row("Sensor1") });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Properties", "Access...", "Zoom To", "Rename", "Delete"]);
    expect(selected()).toEqual(["Sensor1"]);
    for (const name of ["Properties", "Rename", "Delete"]) expect(item(menu, name).getAttribute("aria-disabled"), name).toBeNull();
    expect(item(menu, "Access...").getAttribute("aria-disabled")).toBe("true"); // like the satellite's
  });

  test("the menu follows the row that is right-clicked: sensor, then satellite, then folder, then sensor again", async () => {
    loadSensors({ G01: ["Sensor1"] });
    renderOb();
    const labels = async (target: string) => {
      await user.pointer({ keys: "[MouseRight]", target: row(target) });
      const got = within(await screen.findByRole("menu")).getAllByRole("menuitem").map((m) => m.textContent);
      await user.keyboard("{Escape}");
      return got;
    };
    const SENSOR = ["Properties", "Access...", "Zoom To", "Rename", "Delete"];
    const OTHER = ["Properties", "Access...", "Report & Graph Manager...", "Zoom To", "Rename", "Delete"];
    expect(await labels("Sensor1")).toEqual(SENSOR);
    expect(await labels("G01")).toEqual(OTHER);
    expect(await labels("Mine")).toEqual(OTHER);
    expect(await labels("Sensor1")).toEqual(SENSOR);
    expect(await labels("THBK")).toEqual(OTHER);
  });

  test("Properties, Rename and Delete from a sensor's menu act on that sensor", async () => {
    loadSensors({ G01: ["Sensor1"] });
    renderOb();
    await user.click(row("THBK"));
    await user.pointer({ keys: "[MouseRight]", target: row("Sensor1") });
    await user.click(item(await screen.findByRole("menu"), "Properties"));
    expect(openPanel).toHaveBeenCalledWith("propertiesBrowser", { path: sensorPath("Sensor1"), name: "Sensor1" });
    await user.pointer({ keys: "[MouseRight]", target: row("Sensor1") });
    await user.click(item(await screen.findByRole("menu"), "Delete"));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(spies.remove).toHaveBeenCalledWith("Sensor", "Sensor1"));
  });

  test("Zoom To follows whoever registers object.zoomTo", async () => {
    loadObjects();
    renderOb();
    const run = vi.fn();
    await user.pointer({ keys: "[MouseRight]", target: row("G01") });
    expect(item(await screen.findByRole("menu"), "Zoom To").getAttribute("aria-disabled")).toBe("true");
    await user.keyboard("{Escape}");
    act(() => void registerCommand("object.zoomTo", { label: "menu.object.zoomTo", run }));
    await user.pointer({ keys: "[MouseRight]", target: row("G01") });
    await user.click(item(await screen.findByRole("menu"), "Zoom To"));
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("Properties from the menu opens the right-clicked object, not the previously selected one", async () => {
    loadObjects();
    renderOb();
    await user.click(row("THBK"));
    await user.pointer({ keys: "[MouseRight]", target: row("G02") });
    await user.click(item(await screen.findByRole("menu"), "Properties"));
    expect(openPanel).toHaveBeenCalledWith("propertiesBrowser", { path: satPath("G02"), name: "G02" });
  });

  test("on a folder, Properties, Rename and Delete are disabled", async () => {
    loadObjects();
    renderOb();
    await user.pointer({ keys: "[MouseRight]", target: row("Mine") });
    const menu = await screen.findByRole("menu");
    for (const name of ["Properties", "Rename", "Delete"]) expect(item(menu, name).getAttribute("aria-disabled"), name).toBe("true");
  });
});

describe("Delete", () => {
  test("asks first, then deletes the object", async () => {
    loadObjects();
    renderOb();
    await user.click(row("G01"));
    await user.click(button(t("ob.delete")));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(msg("confirm.delete", { name: "G01" }))).toBeDefined();
    expect(spies.remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(spies.remove).toHaveBeenCalledWith("Satellite", "G01"));
    await waitFor(() => expect(useSelection.getState().activePath).toBe(satPath("G02"))); // the selection moves to the next row
  });

  test("Delete key → OK moves the selection and the focus to the next row, so the arrow keys keep working", async () => {
    loadObjects();
    spies.remove.mockImplementationOnce((async (_cls: string, name: string) => {
      removeFromStore(name);
      return written;
    }) as never);
    stopShortcuts = installShortcuts();
    renderOb();
    await user.click(row("G01"));
    expect(document.activeElement).toBe(row("G01"));
    await user.keyboard("{Delete}");
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: t("dialog.cancel") })));
    await user.keyboard("{Shift>}{Tab}{/Shift}{Enter}"); // OK
    await waitFor(() => expect(spies.remove).toHaveBeenCalledWith("Satellite", "G01"));
    await waitFor(() => expect(hasRow("G01")).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(row("G02")));
    await settle();
    expect(document.activeElement).toBe(row("G02"));
    expect(selected()).toEqual(["G02"]);
    await user.keyboard("{ArrowDown}");
    expect(selected()).toEqual(["Mine"]);
    expect(document.activeElement).toBe(row("Mine"));
  });

  test("right-click → Delete → OK puts the focus on the next row too (the menu it came from is gone)", async () => {
    loadObjects();
    spies.remove.mockImplementationOnce((async (_cls: string, name: string) => {
      removeFromStore(name);
      return written;
    }) as never);
    renderOb();
    await user.pointer({ keys: "[MouseRight]", target: row("G01") });
    await user.click(item(await screen.findByRole("menu"), "Delete"));
    await screen.findByRole("dialog");
    await user.keyboard("{Shift>}{Tab}{/Shift}{Enter}");
    await waitFor(() => expect(hasRow("G01")).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(row("G02")));
    await settle();
    expect(document.activeElement).toBe(row("G02"));
    expect(selected()).toEqual(["G02"]);
  });

  test("deleting the last row moves the selection and the focus to the row before it", async () => {
    loadObjects();
    spies.remove.mockImplementationOnce((async (_cls: string, name: string) => {
      removeFromStore(name);
      return written;
    }) as never);
    stopShortcuts = installShortcuts();
    renderOb();
    await user.click(row("G05"));
    await user.keyboard("{Delete}");
    await screen.findByRole("dialog");
    await user.keyboard("{Shift>}{Tab}{/Shift}{Enter}");
    await waitFor(() => expect(hasRow("G05")).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(row("G04")));
    await settle();
    expect(document.activeElement).toBe(row("G04"));
    expect(selected()).toEqual(["G04"]);
  });

  test("Delete from the toolbar button: the selection moves to the next row and the focus goes back to the button", async () => {
    loadObjects();
    spies.remove.mockImplementationOnce((async (_cls: string, name: string) => {
      removeFromStore(name);
      return written;
    }) as never);
    renderOb();
    await user.click(row("G01"));
    await user.click(button(t("ob.delete")));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(hasRow("G01")).toBe(false));
    await settle();
    expect(selected()).toEqual(["G02"]);
    expect(document.activeElement).toBe(button(t("ob.delete")));
  });

  test("an object deleted while the flag filter hides it has no neighbour: the focus goes to the tree, where the arrow keys start again", async () => {
    loadObjects();
    spies.remove.mockImplementationOnce((async (_cls: string, name: string) => {
      removeFromStore(name);
      return written;
    }) as never);
    renderOb();
    await user.click(row("G01"));
    act(() => runCommand("ob.showFlagged")); // G01 has no flag: its row leaves the list, and the focus with it
    expect(hasRow("G01")).toBe(false);
    act(() => runCommand("object.delete"));
    await screen.findByRole("dialog");
    await user.keyboard("{Shift>}{Tab}{/Shift}{Enter}");
    await waitFor(() => expect(spies.remove).toHaveBeenCalledWith("Satellite", "G01"));
    const tree = screen.getByRole("tree", { name: t("window.objectBrowser") });
    await waitFor(() => expect(document.activeElement).toBe(tree));
    await settle();
    expect(document.activeElement).toBe(tree);
    expect(useSelection.getState().activePath).toBeNull();
    await user.keyboard("{ArrowDown}");
    expect(selected()).toEqual(["S1"]);
  });

  test("a failed delete keeps the selection and gives the focus back to the row", async () => {
    loadObjects();
    spies.remove.mockRejectedValueOnce(new ApiError({ status: 404, code: "NOT_FOUND", text: "ไม่พบ" }));
    stopShortcuts = installShortcuts();
    renderOb();
    await user.click(row("G01"));
    await user.keyboard("{Delete}");
    await screen.findByRole("dialog");
    await user.keyboard("{Shift>}{Tab}{/Shift}{Enter}");
    await waitFor(() => expect(useMessages.getState().items.some((m) => m.code === "NOT_FOUND")).toBe(true));
    await settle();
    expect(selected()).toEqual(["G01"]);
    expect(document.activeElement).toBe(row("G01"));
  });

  test("Cancel deletes nothing", async () => {
    loadObjects();
    renderOb();
    await user.click(row("G01"));
    await user.click(button(t("ob.delete")));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dialog.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(spies.remove).not.toHaveBeenCalled();
    expect(useSelection.getState().activePath).toBe(satPath("G01"));
  });

  test("goes through the real DELETE request with the ETag", async () => {
    loadObjects();
    useScenario.setState({ remove: useScenario.getInitialState().remove } as never);
    const f = stubFetch({
      "DELETE /api/scenarios/S1/objects/Satellite/G01": { json: { etag: "e2" }, headers: { ETag: '"e2"' } },
      "GET /api/scenarios/S1": { json: makeScenarioDoc(), headers: { ETag: '"e2"' } },
      "GET /api/scenarios/S1/objects": { json: makeTree() },
    });
    renderOb();
    await user.click(row("G01"));
    await user.click(button(t("ob.delete")));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(f.count("DELETE /api/scenarios/S1/objects/Satellite/G01")).toBe(1));
    expect(f.calls.find((c) => c.method === "DELETE")!.headers.get("If-Match")).toBe('"e1"');
  });

  test("edit.delete and object.delete do the same, and neither works on a folder or the scenario", async () => {
    loadObjects();
    renderOb();
    expect(isEnabled("edit.delete")).toBe(false);
    expect(isEnabled("object.delete")).toBe(false);
    await user.click(row("G02"));
    expect(isEnabled("edit.delete")).toBe(true);
    expect(isEnabled("object.delete")).toBe(true);
    await user.click(row("Mine"));
    expect(isEnabled("edit.delete")).toBe(false);
    expect(isEnabled("object.delete")).toBe(false);
    await user.click(row("S1"));
    expect(isEnabled("object.delete")).toBe(false);
    await user.click(row("G02"));
    act(() => runCommand("edit.delete"));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(spies.remove).toHaveBeenCalledWith("Satellite", "G02"));
  });

  test("the Delete key inside the Object Browser asks to delete the selected object", async () => {
    loadObjects();
    stopShortcuts = installShortcuts();
    renderOb();
    await user.click(row("G05"));
    await user.keyboard("{Delete}");
    expect(await screen.findByText(msg("confirm.delete", { name: "G05" }))).toBeDefined();
  });

  test("a failed delete is reported", async () => {
    loadObjects();
    renderOb();
    spies.remove.mockRejectedValueOnce(new ApiError({ status: 404, code: "NOT_FOUND", text: "ไม่พบ" }));
    await user.click(row("G01"));
    act(() => runCommand("object.delete"));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(useMessages.getState().items.some((m) => m.code === "NOT_FOUND")).toBe(true));
  });
});

describe("Copy, Cut and Paste", () => {
  test("Copy then Paste inserts <name>_1 with Define Properties and the same NORAD", async () => {
    loadObjects();
    renderOb();
    await user.click(row("G01"));
    await user.click(button(t("ob.copy")));
    await user.click(button(t("ob.paste")));
    expect(spies.insert).toHaveBeenCalledWith({ class: "Satellite", method: "Define Properties", name: "G01_1", norad: 40101 });
  });

  test("uses _2 when G01_1 is taken, ignoring case, and _3 after that", async () => {
    const doc = makeScenarioDoc();
    (doc.objects as { class: string; name: string; norad?: number }[]).push({ class: "Satellite", name: "g01_1", norad: 40101 }, { class: "Constellation", name: "G01_2" });
    loadObjects({ doc });
    renderOb();
    await user.click(row("G01"));
    await user.click(button(t("ob.copy")));
    await user.click(button(t("ob.paste")));
    expect(spies.insert).toHaveBeenCalledWith({ class: "Satellite", method: "Define Properties", name: "G01_3", norad: 40101 });
  });

  test("a copy can be pasted again, and the pasted satellite is selected", async () => {
    loadObjects();
    spies.insert.mockResolvedValueOnce([satPath("G01_1")]);
    renderOb();
    await user.click(row("G01"));
    await user.click(button(t("ob.copy")));
    await user.click(button(t("ob.paste")));
    await waitFor(() => expect(useSelection.getState().activePath).toBe(satPath("G01_1")));
    await user.click(button(t("ob.paste")));
    expect(spies.insert).toHaveBeenCalledTimes(2);
    expect(useClipboard.getState().content).toEqual({ mode: "copy", paths: [satPath("G01")] });
  });

  test("Cut then Paste on a folder moves the satellite into the group through POST /groups", async () => {
    loadObjects();
    useScenario.setState({ setGroup: useScenario.getInitialState().setGroup } as never);
    const f = stubFetch({
      "POST /api/scenarios/S1/groups": { json: { name: "Mine", etag: "e2" }, headers: { ETag: '"e2"' } },
      "GET /api/scenarios/S1": { json: makeScenarioDoc(), headers: { ETag: '"e2"' } },
      "GET /api/scenarios/S1/objects": { json: makeTree() },
    });
    renderOb();
    await user.click(row("G01"));
    await user.click(button(t("ob.cut")));
    await user.click(row("Mine"));
    await user.click(button(t("ob.paste")));
    await waitFor(() => expect(f.count("POST /api/scenarios/S1/groups")).toBe(1));
    const call = f.calls.find((c) => c.method === "POST")!;
    expect(call.body).toEqual({ name: "Mine", members: [satPath("G01")] });
    expect(call.headers.get("If-Match")).toBe('"e1"');
    await waitFor(() => expect(useClipboard.getState().content).toBeNull());
  });

  test("Cut + Paste keeps the folder's members and adds the cut ones once", async () => {
    loadObjects();
    renderOb();
    await user.click(row("G03"));
    await user.click(button(t("ob.cut")));
    await user.click(row("GPS sats"));
    await user.click(button(t("ob.paste")));
    expect(spies.setGroup).toHaveBeenCalledWith("GPS sats", [satPath("G01"), satPath("G02"), satPath("G03")]);
    spies.setGroup.mockClear();
    await user.click(row("G01"));
    await user.click(button(t("ob.cut")));
    await user.click(row("GPS sats"));
    await user.click(button(t("ob.paste")));
    expect(spies.setGroup).toHaveBeenCalledWith("GPS sats", [satPath("G01"), satPath("G02")]);
  });

  test("Paste of a cut is disabled unless a folder is selected", async () => {
    loadObjects();
    renderOb();
    await user.click(row("G01"));
    await user.click(button(t("ob.cut")));
    await user.click(row("G02"));
    expect(button(t("ob.paste")).getAttribute("aria-disabled")).toBe("true");
    expect(isEnabled("edit.paste")).toBe(false);
    await user.click(button(t("ob.paste")));
    expect(spies.setGroup).not.toHaveBeenCalled();
    await user.click(row("Mine"));
    expect(button(t("ob.paste")).getAttribute("aria-disabled")).toBeNull();
  });

  test("Paste is disabled while the clipboard is empty", async () => {
    loadObjects();
    renderOb();
    await user.click(row("Mine"));
    expect(isEnabled("edit.paste")).toBe(false);
  });

  test("Cut and Copy work on satellites only", async () => {
    loadObjects();
    renderOb();
    for (const name of ["THBK", "GPS", "S1", "Mine"]) {
      await user.click(row(name));
      expect(isEnabled("edit.cut"), name).toBe(false);
      expect(isEnabled("edit.copy"), name).toBe(false);
    }
    await user.click(row("G04"));
    expect(isEnabled("edit.cut")).toBe(true);
    expect(isEnabled("edit.copy")).toBe(true);
  });

  test("opening another scenario empties the clipboard", async () => {
    loadObjects();
    renderOb();
    await user.click(row("G01"));
    await user.click(button(t("ob.copy")));
    expect(useClipboard.getState().content).not.toBeNull();
    act(() => useScenario.setState({ name: "S2" }));
    expect(useClipboard.getState().content).toBeNull();
    expect(isEnabled("edit.paste")).toBe(false);
  });

  test("a satellite removed after it was cut is not moved", async () => {
    loadObjects();
    renderOb();
    useClipboard.getState().set("cut", [satPath("Gone")]);
    await user.click(row("Mine"));
    await user.click(button(t("ob.paste")));
    expect(spies.setGroup).not.toHaveBeenCalled();
  });
});

describe("New Group", () => {
  test("asks for a name and creates an empty group", async () => {
    loadObjects();
    renderOb();
    await user.click(button(t("ob.newGroup")));
    const dialog = await screen.findByRole("dialog", { name: t("ob.newGroup") });
    await user.type(within(dialog).getByRole("textbox", { name: t("field.name") }), "Test sats");
    await user.click(within(dialog).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(spies.setGroup).toHaveBeenCalledWith("Test sats", []));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("an empty name and a name already used by a group (any case) are refused in the field", async () => {
    loadObjects();
    renderOb();
    await user.click(button(t("ob.newGroup")));
    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByRole("textbox", { name: t("field.name") });
    await user.click(within(dialog).getByRole("button", { name: t("dialog.ok") }));
    expect(within(dialog).getByRole("alert").textContent).toBe(msg("ob.groupNameEmpty"));
    expect(field.getAttribute("aria-invalid")).toBe("true");
    await user.type(field, "mine");
    await user.click(within(dialog).getByRole("button", { name: t("dialog.ok") }));
    expect(within(dialog).getByRole("alert").textContent).toBe(msg("ob.groupNameTaken", { name: "mine" }));
    expect(spies.setGroup).not.toHaveBeenCalled();
  });

  test("a server 422 or 409 lands on the field and keeps the dialog open", async () => {
    loadObjects();
    renderOb();
    spies.setGroup.mockRejectedValueOnce(new ApiError({ status: 422, code: "SCENARIO_INVALID", text: "ชื่อกลุ่มต้องไม่ว่าง", field: "name" }));
    await user.click(button(t("ob.newGroup")));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: t("field.name") }), "X");
    await user.click(within(dialog).getByRole("button", { name: t("dialog.ok") }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("ชื่อกลุ่มต้องไม่ว่าง");
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  test("Cancel closes it without a request", async () => {
    loadObjects();
    renderOb();
    await user.click(button(t("ob.newGroup")));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dialog.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(spies.setGroup).not.toHaveBeenCalled();
  });
});

describe("Rename", () => {
  test("opens with the current name; a valid new name renames and keeps the object selected under its new path", async () => {
    loadObjects();
    renderOb();
    await user.click(row("G01"));
    act(() => runCommand("object.rename"));
    const dialog = await screen.findByRole("dialog", { name: t("menu.object.rename") });
    const field = within(dialog).getByRole("textbox", { name: t("field.name") }) as HTMLInputElement;
    expect(field.value).toBe("G01");
    await user.clear(field);
    await user.type(field, "GPS01");
    await user.click(within(dialog).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(spies.rename).toHaveBeenCalledWith("Satellite", "G01", "GPS01"));
    await waitFor(() => expect(useSelection.getState().activePath).toBe(satPath("GPS01")));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("Rename → OK leaves the focus on the renamed row (its old row is gone), so the arrow keys keep working", async () => {
    loadObjects();
    spies.rename.mockImplementationOnce((async (_cls: string, name: string, newName: string) => {
      renameInStore(name, newName);
      return written;
    }) as never);
    renderOb();
    await user.click(row("G01"));
    expect(document.activeElement).toBe(row("G01"));
    act(() => runCommand("object.rename"));
    const dialog = await screen.findByRole("dialog", { name: t("menu.object.rename") });
    const field = within(dialog).getByRole("textbox", { name: t("field.name") });
    await user.clear(field);
    await user.type(field, "GPS01{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(row("GPS01")));
    await settle();
    expect(document.activeElement).toBe(row("GPS01"));
    expect(selected()).toEqual(["GPS01"]);
    await user.keyboard("{ArrowDown}");
    expect(selected()).toEqual(["G02"]);
  });

  test("a name with a space, a dot or more than 32 characters is refused before any request", async () => {
    loadObjects();
    renderOb();
    await user.click(row("G01"));
    act(() => runCommand("object.rename"));
    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByRole("textbox", { name: t("field.name") });
    for (const bad of ["bad name", "a.b", "", "x".repeat(33)]) {
      await user.clear(field);
      if (bad !== "") await user.type(field, bad);
      await user.click(within(dialog).getByRole("button", { name: t("dialog.ok") }));
      expect(within(dialog).getByRole("alert").textContent, JSON.stringify(bad)).toBe(msg("ob.nameInvalid"));
    }
    expect(spies.rename).not.toHaveBeenCalled();
  });

  test("a 409 from the server lands on the field and the dialog stays open", async () => {
    loadObjects();
    renderOb();
    spies.rename.mockRejectedValueOnce(new ApiError({ status: 409, code: "NAME_EXISTS", text: "มี object ชื่อ G02 อยู่แล้ว", field: "new_name" }));
    await user.click(row("G01"));
    act(() => runCommand("object.rename"));
    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByRole("textbox", { name: t("field.name") });
    await user.clear(field);
    await user.type(field, "G02");
    await user.click(within(dialog).getByRole("button", { name: t("dialog.ok") }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("มี object ชื่อ G02 อยู่แล้ว");
    expect(field.getAttribute("aria-invalid")).toBe("true");
  });

  test("the same name just closes the dialog", async () => {
    loadObjects();
    renderOb();
    await user.click(row("G01"));
    act(() => runCommand("object.rename"));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(spies.rename).not.toHaveBeenCalled();
  });

  test("is disabled for a folder and for the scenario, with a Thai reason for the folder", async () => {
    loadObjects();
    renderOb();
    expect(isEnabled("object.rename")).toBe(false);
    await user.click(row("S1"));
    expect(isEnabled("object.rename")).toBe(false);
    await user.click(row("Mine"));
    expect(isEnabled("object.rename")).toBe(false);
    await user.click(row("THBK"));
    expect(isEnabled("object.rename")).toBe(true);
  });
});

describe("Find", () => {
  test("opens from the toolbar and from edit.find, and Escape closes it", async () => {
    loadObjects();
    renderOb();
    await user.click(button(t("ob.find")));
    expect(screen.getByRole("dialog", { name: t("ob.find") })).toBeDefined();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: t("ob.findWhat") }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: t("ob.find") })).toBeNull();
    act(() => runCommand("edit.find"));
    expect(screen.getByRole("dialog", { name: t("ob.find") })).toBeDefined();
  });

  test("Ctrl+F inside the Object Browser opens it", async () => {
    loadObjects();
    stopShortcuts = installShortcuts();
    renderOb();
    await user.click(row("G01"));
    await user.keyboard("{Control>}f{/Control}");
    expect(screen.getByRole("dialog", { name: t("ob.find") })).toBeDefined();
  });

  test("g0 selects the first match and Next walks through them and wraps; Previous goes back", async () => {
    loadObjects();
    renderOb();
    await user.click(button(t("ob.find")));
    await user.type(screen.getByRole("textbox", { name: t("ob.findWhat") }), "g0");
    await user.click(screen.getByRole("button", { name: t("ob.findNext") }));
    expect(selected()).toEqual(["G01"]);
    expect(useSelection.getState().activePath).toBe(satPath("G01"));
    const seen: (string | null)[] = [];
    for (let i = 0; i < 5; i++) {
      await user.click(screen.getByRole("button", { name: t("ob.findNext") }));
      seen.push(selected()[0]);
    }
    expect(seen).toEqual(["G02", "G03", "G04", "G05", "G01"]);
    await user.click(screen.getByRole("button", { name: t("ob.findPrevious") }));
    expect(selected()).toEqual(["G05"]);
  });

  test("Enter in the box finds the next match and Shift+Enter the previous", async () => {
    loadObjects();
    renderOb();
    await user.click(button(t("ob.find")));
    await user.type(screen.getByRole("textbox", { name: t("ob.findWhat") }), "g0{Enter}");
    expect(selected()).toEqual(["G01"]);
    await user.keyboard("{Enter}");
    expect(selected()).toEqual(["G02"]);
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(selected()).toEqual(["G01"]);
  });

  test("changing the text starts again from the first match", async () => {
    loadObjects();
    renderOb();
    await user.click(button(t("ob.find")));
    const box = screen.getByRole("textbox", { name: t("ob.findWhat") });
    await user.type(box, "g0{Enter}{Enter}{Enter}");
    expect(selected()).toEqual(["G03"]);
    await user.clear(box);
    await user.type(box, "G0{Enter}");
    expect(selected()).toEqual(["G01"]);
  });

  test("finds by PRN when the satellite was renamed", async () => {
    const tree = makeTree({ groups: [], loose: ["Alpha"] });
    const doc = makeScenarioDoc();
    (doc.objects as { class: string; name: string; norad?: number }[]).push({ class: "Satellite", name: "Alpha", norad: 40103 });
    loadObjects({ tree, doc });
    renderOb();
    await user.click(button(t("ob.find")));
    await user.type(screen.getByRole("textbox", { name: t("ob.findWhat") }), "g03{Enter}");
    expect(selected()).toEqual(["Alpha"]);
  });

  test("a match inside a collapsed folder opens the folder", async () => {
    loadObjects();
    renderOb();
    await user.dblClick(row("GPS sats"));
    expect(hasRow("G02")).toBe(false);
    await user.click(button(t("ob.find")));
    await user.type(screen.getByRole("textbox", { name: t("ob.findWhat") }), "g02{Enter}");
    expect(hasRow("G02")).toBe(true);
    expect(selected()).toEqual(["G02"]);
  });

  test("Enter on Find Previous goes backwards and Enter on Close closes: only the text box turns Enter into Find Next", async () => {
    loadObjects();
    renderOb();
    await user.click(button(t("ob.find")));
    await user.type(screen.getByRole("textbox", { name: t("ob.findWhat") }), "g0{Enter}{Enter}{Enter}");
    expect(selected()).toEqual(["G03"]);
    screen.getByRole("button", { name: t("ob.findPrevious") }).focus();
    await user.keyboard("{Enter}");
    expect(selected()).toEqual(["G02"]);
    screen.getByRole("button", { name: t("ob.findNext") }).focus();
    await user.keyboard("{Enter}");
    expect(selected()).toEqual(["G03"]);
    screen.getByRole("button", { name: t("dialog.windows.close") }).focus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog", { name: t("ob.find") })).toBeNull();
    expect(selected()).toEqual(["G03"]);
  });

  test("Next and Previous carry on from where the selection is now when it is not the last hit", async () => {
    loadObjects();
    renderOb();
    await user.click(button(t("ob.find")));
    await user.type(screen.getByRole("textbox", { name: t("ob.findWhat") }), "g0{Enter}");
    expect(selected()).toEqual(["G01"]);
    await user.click(row("G04"));
    await user.click(screen.getByRole("button", { name: t("ob.findNext") }));
    expect(selected()).toEqual(["G05"]);
    await user.click(row("G02"));
    await user.click(screen.getByRole("button", { name: t("ob.findPrevious") }));
    expect(selected()).toEqual(["G01"]);
    await user.click(row("THBK")); // not a match itself: Next goes to the first match after it
    await user.click(screen.getByRole("button", { name: t("ob.findNext") }));
    expect(selected()).toEqual(["G01"]);
    await user.click(row("Mine"));
    await user.click(screen.getByRole("button", { name: t("ob.findPrevious") }));
    expect(selected()).toEqual(["G02"]);
  });

  test("a folder can be found and selected", async () => {
    loadObjects();
    renderOb();
    await user.click(button(t("ob.find")));
    await user.type(screen.getByRole("textbox", { name: t("ob.findWhat") }), "mine{Enter}");
    expect(selected()).toEqual(["Mine"]);
  });

  test("no match says so in Thai and changes nothing", async () => {
    loadObjects();
    renderOb();
    await user.click(row("G05"));
    await user.click(button(t("ob.find")));
    await user.type(screen.getByRole("textbox", { name: t("ob.findWhat") }), "zzz{Enter}");
    expect(screen.getByText(msg("ob.findNoMatch", { query: "zzz" }))).toBeDefined();
    expect(selected()).toEqual(["G05"]);
  });

  test("focus stays in the box so Enter can keep going", async () => {
    loadObjects();
    renderOb();
    await user.click(button(t("ob.find")));
    const box = screen.getByRole("textbox", { name: t("ob.findWhat") });
    await user.type(box, "g0{Enter}");
    expect(document.activeElement).toBe(box);
  });

  test("Find is unavailable without a scenario", () => {
    renderOb();
    expect(isEnabled("edit.find")).toBe(false);
  });
});

describe("keyboard", () => {
  test("ArrowDown and ArrowUp move the selection and the focus; Home and End jump", async () => {
    loadObjects();
    renderOb();
    await user.click(row("G01"));
    await user.keyboard("{ArrowDown}");
    expect(selected()).toEqual(["G02"]);
    expect(document.activeElement).toBe(row("G02"));
    expect(useSelection.getState().activePath).toBe(satPath("G02"));
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(selected()).toEqual(["GPS sats"]);
    await user.keyboard("{End}");
    expect(selected()).toEqual(["G05"]);
    await user.keyboard("{Home}");
    expect(selected()).toEqual(["S1"]);
    await user.keyboard("{ArrowUp}");
    expect(selected()).toEqual(["S1"]);
  });

  test("only the selected row is a tab stop; with no selection it is the first row", async () => {
    loadObjects();
    renderOb();
    expect(treeitems().map((r) => r.tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1, -1, -1, -1]);
    await user.click(row("G02"));
    expect(treeitems().filter((r) => r.tabIndex === 0).map((r) => r.textContent)).toEqual(["G02"]);
  });

  test("ArrowLeft collapses an open folder, then climbs to the parent; ArrowRight opens, then goes to the first child", async () => {
    loadObjects();
    renderOb();
    await user.click(row("GPS sats"));
    await user.keyboard("{ArrowLeft}");
    expect(hasRow("G01")).toBe(false);
    expect(selected()).toEqual(["GPS sats"]);
    await user.keyboard("{ArrowRight}");
    expect(hasRow("G01")).toBe(true);
    expect(selected()).toEqual(["GPS sats"]);
    await user.keyboard("{ArrowRight}");
    expect(selected()).toEqual(["G01"]);
    await user.keyboard("{ArrowRight}");
    expect(selected()).toEqual(["G01"]);
    await user.keyboard("{ArrowLeft}");
    expect(selected()).toEqual(["GPS sats"]);
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(selected()).toEqual(["S1"]);
    await user.keyboard("{ArrowLeft}");
    expect(names()).toEqual(["S1"]);
  });

  test("Enter opens Properties of the focused object", async () => {
    loadObjects();
    renderOb();
    await user.click(row("G04"));
    await user.keyboard("{Enter}");
    expect(openPanel).toHaveBeenCalledWith("propertiesBrowser", { path: satPath("G04"), name: "G04" });
  });

  test("Space toggles Show of the focused object, once", async () => {
    loadObjects();
    renderOb();
    await user.click(row("G04"));
    await user.keyboard(" ");
    expect(spies.patchObject).toHaveBeenCalledTimes(1);
    expect(spies.patchObject).toHaveBeenCalledWith("Satellite", "G04", { graphics2d: { show: false }, graphics3d: { show: false } });
  });

  test("Space does nothing on a folder, a hidden satellite or while the checkbox column is off", async () => {
    loadObjects();
    renderOb();
    await user.click(row("Mine"));
    await user.keyboard(" ");
    await user.click(row("G03"));
    await user.keyboard(" ");
    expect(spies.patchObject).not.toHaveBeenCalled();
    act(() => runCommand("ob.onOffToggles"));
    await user.click(row("G04"));
    await user.keyboard(" ");
    expect(spies.patchObject).not.toHaveBeenCalled();
  });
});

describe("toolbar and columns", () => {
  test("has Properties, Graphics Color Selectors, Graphics On/Off Toggles, New Group, Cut, Copy, Paste, Delete, Find, Expand All, Collapse All in that order", () => {
    loadObjects();
    renderOb();
    const bar = screen.getByRole("toolbar", { name: t("window.objectBrowser") });
    expect(within(bar).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Properties", "Graphics Color Selectors", "Graphics On/Off Toggles", "New Group", "Cut", "Copy", "Paste", "Delete", "Find", "Expand All", "Collapse All",
    ]);
  });

  test("Graphics Color Selectors hides and shows the colour boxes", async () => {
    loadObjects();
    renderOb();
    const toggle = button(t("ob.graphicsColorSelectors"));
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await user.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(within(row("G01")).queryByRole("img", { name: new RegExp(t("field.color")) })).toBeNull();
    expect(within(row("G01")).queryByRole("checkbox")).not.toBeNull();
    await user.click(toggle);
    expect(swatch("G01")).toBeDefined();
  });

  test("Graphics On/Off Toggles hides and shows the checkboxes", async () => {
    loadObjects();
    renderOb();
    const toggle = button(t("ob.graphicsOnOffToggles"));
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await user.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(within(row("G01")).queryByRole("checkbox")).toBeNull();
    expect(swatch("G01")).toBeDefined();
    await user.click(toggle);
    expect(checkbox("G01")).toBeDefined();
  });

  test("every toolbar button is aria-disabled until its command is usable", () => {
    renderOb();
    for (const key of ["ob.properties", "ob.newGroup", "ob.cut", "ob.copy", "ob.paste", "ob.delete", "ob.find", "ob.expandAll", "ob.collapseAll"] as const) {
      expect(button(t(key)).getAttribute("aria-disabled"), key).toBe("true");
    }
  });
});

describe("flagged satellites", () => {
  test("ob.showFlagged keeps only the flagged satellites and the folders that hold one; running it again undoes it", () => {
    loadObjects({ tree: makeTree({ groups: [{ group: "GPS sats", children: ["G01", "G04"] }, { group: "Mine", children: ["G02"] }], loose: ["G03", "G05"] }) });
    renderOb();
    act(() => runCommand("ob.showFlagged"));
    expect(names()).toEqual(["S1", "GPS sats", "G04", "G03"]);
    act(() => runCommand("ob.showFlagged"));
    expect(names()).toEqual(["S1", "THBK", "GPS", "GPS sats", "G01", "G04", "Mine", "G02", "G03", "G05"]);
  });

  test("while it is on, a strip says so and clears it", async () => {
    loadObjects();
    renderOb();
    act(() => runCommand("ob.showFlagged"));
    const strip = screen.getByRole("status");
    expect(strip.textContent).toContain(t("status.flaggedSatellites"));
    await user.click(within(strip).getByRole("button"));
    expect(screen.queryByRole("status")).toBeNull();
    expect(hasRow("THBK")).toBe(true);
  });

  test("when nothing is flagged it says so", () => {
    loadObjects({ catalog: [entry(1), entry(2), entry(3), entry(4), entry(5)] });
    renderOb();
    act(() => runCommand("ob.showFlagged"));
    expect(screen.getByText(msg("ob.noFlagged"))).toBeDefined();
  });
});

describe("commands", () => {
  test("every Object Browser command is registered at app start, stays when the window closes, and goes with the disposer", () => {
    loadObjects();
    const ids = ["edit.cut", "edit.copy", "edit.paste", "edit.delete", "edit.find", "object.properties", "object.rename", "object.delete",
                 "ob.newGroup", "ob.expandAll", "ob.collapseAll", "ob.colorSelectors", "ob.onOffToggles", "ob.showFlagged"] as const;
    for (const id of ids) expect(isRegistered(id), id).toBe(true); // by beforeEach, with no window open
    const { unmount } = renderOb();
    for (const id of ids) expect(isRegistered(id), id).toBe(true);
    unmount();
    for (const id of ids) expect(isRegistered(id), id).toBe(true);
    disposeCommands();
    for (const id of ids) expect(isRegistered(id), id).toBe(false);
    disposeCommands = registerObjectBrowserCommands();
  });

  test("does not register object.zoomTo, object.access or object.reportGraphManager", () => {
    loadObjects();
    renderOb();
    for (const id of ["object.zoomTo", "object.access", "object.reportGraphManager"] as const) expect(isRegistered(id), id).toBe(false);
  });

  test("disabled commands explain why in Thai", async () => {
    loadObjects();
    renderOb();
    await user.click(row("THBK"));
    const { commandTooltip } = await import("../../src/commands");
    expect(commandTooltip("edit.copy")).toBe(msg("ob.satelliteOnly"));
    await user.click(row("Mine"));
    expect(commandTooltip("object.rename")).toBe(msg("ob.groupUnsupported"));
  });

  test("the menu bar's Edit commands see the selection", async () => {
    loadObjects();
    renderOb();
    await user.click(row("G01"));
    act(() => invalidateCommands());
    expect(isEnabled("edit.copy")).toBe(true);
    act(() => runCommand("edit.copy"));
    expect(useClipboard.getState().content).toEqual({ mode: "copy", paths: [satPath("G01")] });
  });
});

describe("a long tree", () => {
  // jsdom has no layout: give the scroll area a height, let it know how tall the list is, and let it scroll the way a browser does
  // (the scroll event comes later, not inside the call)
  const saved: [string, PropertyDescriptor | undefined][] = [];
  const polyfill = () => {
    const define = (name: string, descriptor: PropertyDescriptor) => {
      saved.push([name, Object.getOwnPropertyDescriptor(Element.prototype, name)]);
      Object.defineProperty(Element.prototype, name, { configurable: true, ...descriptor });
    };
    const isScroller = (el: Element) => el.classList.contains("ob-scroll");
    define("clientHeight", { get(this: Element) { return isScroller(this) ? 400 : 0; } });
    define("scrollHeight", { get(this: Element) { return isScroller(this) ? parseFloat((this.firstElementChild as HTMLElement | null)?.style.height || "0") : 0; } });
    define("scrollTo", {
      value(this: Element, arg: { top?: number }) {
        this.scrollTop = arg.top ?? 0;
        setTimeout(() => this.dispatchEvent(new Event("scroll")), 0);
      },
    });
  };
  afterEach(() => {
    for (const [name, descriptor] of saved.splice(0).reverse()) {
      if (descriptor === undefined) delete (Element.prototype as unknown as Record<string, unknown>)[name];
      else Object.defineProperty(Element.prototype, name, descriptor);
    }
  });

  const long = (length = 150) => {
    const loose = Array.from({ length }, (_, i) => `S${String(i).padStart(3, "0")}`);
    return loadObjects({ tree: makeTree({ groups: [], loose }), catalog: CATALOG });
  };

  test("only the rows near the viewport are in the DOM", () => {
    polyfill();
    long();
    renderOb();
    expect(treeitems().length).toBeGreaterThan(5);
    expect(treeitems().length).toBeLessThan(80);
    expect(hasRow("S149")).toBe(false);
  });

  test("End reaches the last row and scrolls it into view", async () => {
    polyfill();
    long();
    renderOb();
    await user.click(row("S000"));
    await user.keyboard("{End}");
    await waitFor(() => expect(hasRow("S149")).toBe(true));
    expect(selected()).toEqual(["S149"]);
    expect(useSelection.getState().activePath).toBe(satPath("S149"));
    await waitFor(() => expect(document.activeElement).toBe(row("S149")));
  });

  test("Find brings a far-away match into view", async () => {
    polyfill();
    long();
    renderOb();
    await user.click(button(t("ob.find")));
    await user.type(screen.getByRole("textbox", { name: t("ob.findWhat") }), "S149{Enter}");
    await waitFor(() => expect(hasRow("S149")).toBe(true));
    expect(selected()).toEqual(["S149"]);
  });

  test("PageDown and PageUp move the selection by one visible page and the focus follows", async () => {
    polyfill();
    long(200);
    renderOb();
    await user.click(row("S000")); // row 3 of the list (after S1, THBK, GPS); the 400px scroll area shows 18 rows
    for (let i = 0; i < 5; i++) await user.keyboard("{PageDown}");
    await waitFor(() => expect(selected()).toEqual(["S090"]));
    await waitFor(() => expect(document.activeElement).toBe(row("S090")));
    expect(document.activeElement?.getAttribute("role")).toBe("treeitem");
    await user.keyboard("{PageUp}{PageUp}");
    await waitFor(() => expect(selected()).toEqual(["S054"]));
    await waitFor(() => expect(document.activeElement).toBe(row("S054")));
    for (let i = 0; i < 20; i++) await user.keyboard("{PageDown}");
    await waitFor(() => expect(selected()).toEqual(["S199"])); // stops at the end
    for (let i = 0; i < 20; i++) await user.keyboard("{PageUp}");
    await waitFor(() => expect(selected()).toEqual(["S1"]));
  });

  test("the selected row stays in the DOM and keeps the tab stop when the list is scrolled far away, so Tab still reaches the tree", async () => {
    polyfill();
    long(200);
    const { container } = renderOb();
    await user.click(row("S000"));
    const scroller = container.querySelector<HTMLElement>(".ob-scroll")!;
    scroller.scrollTop = 4000;
    fireEvent.scroll(scroller);
    await waitFor(() => expect(hasRow("S190")).toBe(true));
    expect(hasRow("S010")).toBe(false); // really scrolled away
    expect(hasRow("S000")).toBe(true); // yet the selected row is still there
    expect(treeitems().filter((r) => r.tabIndex === 0).map((r) => r.textContent)).toEqual(["S000"]);
    expect(document.activeElement).toBe(row("S000")); // and it did not lose the focus
    button(t("ob.collapseAll")).focus();
    await user.tab();
    expect(document.activeElement).toBe(row("S000"));
  });

  test("with no selection the first row is the tab stop wherever the list is scrolled", async () => {
    polyfill();
    long(200);
    const { container } = renderOb();
    const scroller = container.querySelector<HTMLElement>(".ob-scroll")!;
    scroller.scrollTop = 4000;
    fireEvent.scroll(scroller);
    await waitFor(() => expect(hasRow("S190")).toBe(true));
    expect(treeitems().filter((r) => r.tabIndex === 0).map((r) => r.textContent)).toEqual(["S1"]);
  });
});


describe("writes in quick succession through the real store", () => {
  /** server ปลอมที่รับการเขียนเฉพาะเมื่อ If-Match ตรงกับ ETag ปัจจุบัน ไม่งั้น 412 เหมือนของจริง */
  function strictServer(gates: Record<string, Promise<unknown>> = {}) {
    const s = { n: 1, etag: '"e1"', rejected: 0, accepted: [] as string[] };
    const patch = (name: string) => async (call: { headers: Headers }) => {
      await gates[name];
      if (call.headers.get("if-match") !== s.etag) {
        s.rejected++;
        return { status: 412, json: { code: "ETAG_MISMATCH", text: "ถูกแก้จากที่อื่น" } };
      }
      s.accepted.push(`${name} with ${call.headers.get("if-match")}`);
      s.n++;
      s.etag = `"e${s.n}"`;
      return { json: { etag: s.etag, results_stale: false }, headers: { ETag: s.etag } };
    };
    const f = stubFetch({
      "PATCH /api/scenarios/S1/objects/Satellite/G01": patch("G01"),
      "PATCH /api/scenarios/S1/objects/Satellite/G02": patch("G02"),
      "PATCH /api/scenarios/S1/objects/Facility/THBK": patch("THBK"),
      "GET /api/scenarios/S1": () => ({ json: makeScenarioDoc(), headers: { ETag: s.etag } }),
      "GET /api/scenarios/S1/objects": () => ({ json: makeTree(), headers: { ETag: s.etag } }),
    });
    return { s, f };
  }

  beforeEach(() => {
    loadObjects();
    useScenario.setState({ patchObject: useScenario.getInitialState().patchObject } as never);
  });

  test("a click on another row in the middle of a Constellation toggle gets no 412 and no conflict dialog", async () => {
    const first = deferred<void>();
    const { s, f } = strictServer({ G01: first.promise });
    renderOb();
    await user.click(checkbox("GPS"));
    await waitFor(() => expect(f.count("PATCH /api/scenarios/S1/objects/Satellite/G01")).toBe(1));
    expect((checkbox("G02") as HTMLInputElement).disabled).toBe(true); // a member the toggle is about to write
    await user.click(checkbox("G02"));
    await user.click(checkbox("THBK")); // another object, clicked while the first member is still being written
    expect(f.count("PATCH /api/scenarios/S1/objects/Facility/THBK")).toBe(0); // waits its turn
    first.resolve();
    await waitFor(() => expect(s.accepted).toHaveLength(3));
    expect(s.accepted).toEqual(["G01 with \"e1\"", "THBK with \"e2\"", "G02 with \"e3\""]);
    expect(s.rejected).toBe(0);
    expect(useScenario.getState().conflict).toBe(false);
    expect(screen.queryByText(msg("conflict.title"))).toBeNull();
    await waitFor(() => expect((checkbox("G02") as HTMLInputElement).disabled).toBe(false));
  });

  test("two rows ticked one straight after the other are both accepted", async () => {
    const { s } = strictServer();
    renderOb();
    await user.click(checkbox("G01"));
    await user.click(checkbox("THBK"));
    await waitFor(() => expect(s.accepted).toHaveLength(2));
    expect(s.rejected).toBe(0);
    expect(useScenario.getState().conflict).toBe(false);
  });
});

describe("with the Object Browser window closed", () => {
  test("object.delete on the selected satellite still asks and deletes", async () => {
    loadObjects();
    render(<Dialogs />); // no window
    expect(screen.queryAllByRole("treeitem")).toEqual([]);
    act(() => useSelection.getState().select(satPath("G01")));
    expect(isEnabled("object.delete")).toBe(true);
    expect(isEnabled("edit.delete")).toBe(true);
    act(() => runCommand("object.delete"));
    expect(await screen.findByText(msg("confirm.delete", { name: "G01" }))).toBeDefined();
    expect(spies.remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(spies.remove).toHaveBeenCalledWith("Satellite", "G01"));
  });

  test("ob.showFlagged still toggles the filter, and the window shows it when it opens", () => {
    loadObjects();
    expect(useObjectBrowser.getState().flaggedOnly).toBe(false);
    expect(isEnabled("ob.showFlagged")).toBe(true);
    act(() => runCommand("ob.showFlagged"));
    expect(useObjectBrowser.getState().flaggedOnly).toBe(true);
    renderOb();
    expect(names()).toEqual(["S1", "G03", "G04"]);
    act(() => runCommand("ob.showFlagged"));
    expect(useObjectBrowser.getState().flaggedOnly).toBe(false);
  });

  test("Copy and Paste work without the window, and the tree is not needed on screen", async () => {
    loadObjects();
    act(() => useSelection.getState().select(satPath("G02")));
    expect(isEnabled("edit.copy")).toBe(true);
    expect(isEnabled("edit.paste")).toBe(false);
    act(() => runCommand("edit.copy"));
    expect(isEnabled("edit.paste")).toBe(true);
    act(() => runCommand("edit.paste"));
    await waitFor(() => expect(spies.insert).toHaveBeenCalledWith({ class: "Satellite", method: "Define Properties", name: "G02_1", norad: 40102 }));
  });

  test("Find, New Group and Rename open the window and the dialog shows once it is there", async () => {
    loadObjects();
    useLayout.setState({ api: {} as never, openPanel } as never);
    act(() => useSelection.getState().select(satPath("G01")));
    act(() => runCommand("edit.find"));
    act(() => runCommand("ob.newGroup"));
    expect(openPanel).toHaveBeenCalledWith("objectBrowser");
    expect(openPanel).toHaveBeenCalledTimes(2);
    act(() => useObjectBrowser.setState({ newGroupOpen: false }));
    act(() => runCommand("object.rename"));
    expect(openPanel).toHaveBeenCalledTimes(3);
    renderOb();
    expect(screen.getByRole("dialog", { name: t("ob.find"), hidden: true })).toBeDefined(); // (hidden from the tree of roles by the modal Rename over it)
    expect(((await screen.findByRole("textbox", { name: t("field.name") })) as HTMLInputElement).value).toBe("G01");
    expect(screen.getByRole("dialog", { name: t("menu.object.rename") })).toBeDefined();
  });

  test("Expand All, Collapse All and the column toggles work without the window and are still there when it opens", async () => {
    loadObjects();
    act(() => runCommand("ob.collapseAll"));
    act(() => runCommand("ob.colorSelectors"));
    const { unmount } = renderOb();
    expect(names()).toEqual(["S1", "THBK", "GPS", "GPS sats", "Mine", "G03", "G04", "G05"]);
    expect(within(row("G03")).queryByRole("img", { name: new RegExp(t("field.color")) })).toBeNull();
    act(() => runCommand("ob.expandAll"));
    expect(hasRow("G01")).toBe(true);
    unmount();
    act(() => runCommand("ob.collapseAll"));
    renderOb();
    expect(hasRow("G01")).toBe(false);
    expect(button(t("ob.graphicsColorSelectors")).getAttribute("aria-pressed")).toBe("false");
  });

  test("the toolbar buttons of a window that opens later reflect the selection that was made while it was closed", async () => {
    loadObjects();
    act(() => useSelection.getState().select(satPath("G05")));
    renderOb();
    expect(button(t("ob.delete")).getAttribute("aria-disabled")).toBeNull();
    expect(button(t("ob.properties")).getAttribute("aria-disabled")).toBeNull();
    expect(selected()).toEqual(["G05"]);
  });
});

describe("panel registration", () => {
  test("registerObjectBrowserPanel puts the component on the objectBrowser kind and keeps its window settings", () => {
    const before = getPanelDef("objectBrowser")!;
    registerObjectBrowserPanel();
    const def = getPanelDef("objectBrowser")!;
    expect(def.component).toBe(ObjectBrowser);
    expect(def).toMatchObject({ type: before.type, edge: before.edge, size: before.size, persist: true, scenarioBound: false, singleton: true });
    expect(def.title({})).toBe(t("window.objectBrowser"));
    registerObjectBrowserPanel();
    expect(getPanelDef("objectBrowser")!.component).toBe(ObjectBrowser);
  });
});
