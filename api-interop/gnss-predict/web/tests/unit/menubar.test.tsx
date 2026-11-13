import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CommandContextMenu } from "../../src/chrome/ContextMenu";
import { MenuBar } from "../../src/chrome/MenuBar";
import { OBJECT_MENU, objectMenuFor } from "../../src/chrome/menus";
import { registerCommand } from "../../src/commands";
import { t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { useLayout } from "../../src/stores/layout";
import { useSelection } from "../../src/stores/selection";
import { Workspace } from "../../src/Workspace";
import { openScenario, resetWithCoreCommands } from "./helpers/chrome";

let disposeCore: () => void;
beforeEach(() => {
  disposeCore = resetWithCoreCommands();
});
afterEach(() => {
  cleanup();
  disposeCore();
  vi.restoreAllMocks();
});

const topLevel = () => within(screen.getByRole("menubar")).getAllByRole("menuitem").map((m) => m.textContent);

async function openMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(within(screen.getByRole("menubar")).getByRole("menuitem", { name }));
  return screen.findByRole("menu");
}
const item = (menu: HTMLElement, name: string | RegExp) => within(menu).getByRole("menuitem", { name });

/** Workspace จริง (มี dockview) พร้อมเมนูบาร์ใน header */
async function mountWorkspace() {
  render(<Workspace header={<MenuBar />} />);
  await waitFor(() => expect(useLayout.getState().api).not.toBeNull());
}

describe("top-level menus", () => {
  test("are exactly File, Edit, View, Insert, Analysis, <class>, Utilities, Window, Help", () => {
    render(<MenuBar />);
    expect(topLevel()).toEqual(["File", "Edit", "View", "Insert", "Analysis", "Scenario", "Utilities", "Window", "Help"]);
  });

  test("the sixth menu is named after the class of the selected object", () => {
    render(<MenuBar />);
    act(() => useSelection.getState().select("*/Satellite/G01"));
    expect(topLevel()[5]).toBe("Satellite");
    act(() => useSelection.getState().select("*/Facility/THBK"));
    expect(topLevel()[5]).toBe("Facility");
    act(() => useSelection.getState().select("*/Constellation/GPS"));
    expect(topLevel()[5]).toBe("Constellation");
    act(() => useSelection.getState().select("*/Sensor/Sensor1"));
    expect(topLevel()[5]).toBe("Sensor");
    act(() => useSelection.getState().select("*"));
    expect(topLevel()[5]).toBe("Scenario");
    act(() => useSelection.getState().select(null));
    expect(topLevel()[5]).toBe("Scenario");
    expect(topLevel().filter((_, i) => i !== 5)).toEqual(["File", "Edit", "View", "Insert", "Analysis", "Utilities", "Window", "Help"]);
  });

  test("a path that is not an object (a group folder, junk) falls back to Scenario", () => {
    render(<MenuBar />);
    act(() => useSelection.getState().select("*/Group/GPS"));
    expect(topLevel()[5]).toBe("Scenario");
  });
});

describe("menu contents", () => {
  test("the class menu lists Properties, Access..., Report & Graph Manager..., Zoom To, Rename, Delete", async () => {
    const user = userEvent.setup();
    render(<MenuBar />);
    act(() => useSelection.getState().select("*/Satellite/G01"));
    const menu = await openMenu(user, "Satellite");
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "Properties", "Access...", "Report & Graph Manager...", "Zoom To", "Rename", "Delete",
    ]);
  });

  test("the Sensor menu lists Properties, Access..., Zoom To, Rename, Delete; Access... is disabled like the satellite's", async () => {
    const user = userEvent.setup();
    render(<MenuBar />);
    act(() => useSelection.getState().select("*/Sensor/Sensor1"));
    const menu = await openMenu(user, "Sensor");
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Properties", "Access...", "Zoom To", "Rename", "Delete"]);
    expect(item(menu, "Access...").getAttribute("aria-disabled")).toBe("true");
  });

  test("the Facility, Constellation and Scenario menus keep their items", async () => {
    const user = userEvent.setup();
    render(<MenuBar />);
    for (const [path, label] of [["*/Facility/THBK", "Facility"], ["*/Constellation/GPS", "Constellation"], ["*", "Scenario"]] as const) {
      act(() => useSelection.getState().select(path));
      const menu = await openMenu(user, label);
      expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent), label).toEqual([
        "Properties", "Access...", "Report & Graph Manager...", "Zoom To", "Rename", "Delete",
      ]);
      await user.keyboard("{Escape}");
    }
  });

  test("the menu changes back to the satellite's when the selection leaves the sensor", async () => {
    const user = userEvent.setup();
    render(<MenuBar />);
    act(() => useSelection.getState().select("*/Sensor/Sensor1"));
    act(() => useSelection.getState().select("*/Satellite/G01"));
    const menu = await openMenu(user, "Satellite");
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "Properties", "Access...", "Report & Graph Manager...", "Zoom To", "Rename", "Delete",
    ]);
  });

  test("objectMenuFor gives the Sensor its own entries and every other class (or none) the common ones", () => {
    const commands = (cls: Parameters<typeof objectMenuFor>[0]) => objectMenuFor(cls).filter((e) => "command" in e).map((e) => ("command" in e ? e.command : ""));
    expect(commands("Sensor")).toEqual(["object.properties", "object.access", "object.zoomTo", "object.rename", "object.delete"]);
    for (const cls of ["Satellite", "Facility", "Constellation", "Scenario", undefined] as const) {
      expect(objectMenuFor(cls), String(cls)).toBe(OBJECT_MENU);
    }
  });

  test("each of the other menus lists its items in the spec order", async () => {
    const user = userEvent.setup();
    render(<MenuBar />);
    const names = async (menu: string) => {
      const m = await openMenu(user, menu);
      const got = within(m).getAllByRole("menuitem").map((i) => i.querySelector(".menu-label")?.textContent ?? i.textContent);
      await user.keyboard("{Escape}");
      return got;
    };
    expect(await names("File")).toEqual(["New...", "Open...", "Save", "Save As...", "Close", "Exit"]);
    expect(await names("Edit")).toEqual(["Cut", "Copy", "Paste", "Delete", "Find..."]);
    expect(await names("Insert")).toEqual(["New...", "Facility...", "Satellite...", "Constellation..."]);
    expect(await names("Utilities")).toEqual(["Fetch Orbit Data...", "Daily Forecast Settings..."]);
    expect(await names("Help")).toEqual(["Welcome...", "STK UI Reference", "About GNSS Studio"]);
  });

  test("Save, Delete and Find show their shortcuts", async () => {
    const user = userEvent.setup();
    render(<MenuBar />);
    const file = await openMenu(user, "File");
    expect(item(file, /^Save\s*Ctrl\+S$/)).toBeDefined();
    await user.keyboard("{Escape}");
    const edit = await openMenu(user, "Edit");
    expect(item(edit, /^Delete\s*Delete$/)).toBeDefined();
    expect(item(edit, /^Find\.\.\.\s*Ctrl\+F$/)).toBeDefined();
  });

  test("the Recent entries appear only once their commands are registered", async () => {
    const user = userEvent.setup();
    render(<MenuBar />);
    let file = await openMenu(user, "File");
    expect(within(file).queryByRole("menuitem", { name: /recent|T1/i })).toBeNull();
    await user.keyboard("{Escape}");
    act(() => registerCommand("file.recent.1", { label: "menu.file.recent", run: vi.fn(), text: () => "T1" }));
    file = await openMenu(user, "File");
    expect(item(file, "T1")).toBeDefined();
  });
});

describe("disabled items", () => {
  test("Analysis lists its three items, all aria-disabled", async () => {
    const user = userEvent.setup();
    render(<MenuBar />);
    const menu = await openMenu(user, "Analysis");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Access...", "Report & Graph Manager...", "Validation..."]);
    for (const i of items) expect(i.getAttribute("aria-disabled")).toBe("true");
  });

  test("hovering a disabled Analysis item shows the Thai note that it belongs to sub-project 4", async () => {
    const user = userEvent.setup();
    render(<MenuBar />);
    const menu = await openMenu(user, "Analysis");
    await user.hover(item(menu, "Validation..."));
    const tip = await screen.findByRole("tooltip");
    expect(tip.textContent).toBe(msg("tooltip.subtask4"));
  });

  test("a disabled item can be reached with the keyboard, and then shows its reason", async () => {
    const user = userEvent.setup();
    render(<MenuBar />);
    await openMenu(user, "Analysis");
    await user.keyboard("{ArrowDown}"); // first item (a disabled item is still reachable)
    expect(document.activeElement?.textContent).toBe("Access...");
    expect((await screen.findByRole("tooltip")).textContent).toBe(msg("tooltip.subtask4"));
  });

  test("choosing a disabled item does nothing and keeps the menu open", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    registerCommand("analysis.validation", { label: "menu.analysis.validation", run, enabled: () => false });
    render(<MenuBar />);
    const menu = await openMenu(user, "Analysis");
    await user.click(item(menu, "Validation..."));
    expect(run).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeNull();
  });

  test("Access... and Report & Graph Manager... of the class menu carry the same note", async () => {
    const user = userEvent.setup();
    render(<MenuBar />);
    const menu = await openMenu(user, "Scenario");
    for (const name of ["Access...", "Report & Graph Manager..."]) expect(item(menu, name).getAttribute("aria-disabled"), name).toBe("true");
    await user.hover(item(menu, "Access..."));
    expect((await screen.findByRole("tooltip")).textContent).toBe(msg("tooltip.subtask4"));
  });

  test("an item turns enabled as soon as its command is registered", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(<MenuBar />);
    let menu = await openMenu(user, "Analysis");
    expect(item(menu, "Access...").getAttribute("aria-disabled")).toBe("true");
    await user.keyboard("{Escape}");
    act(() => registerCommand("analysis.access", { label: "menu.analysis.access", run }));
    menu = await openMenu(user, "Analysis");
    expect(item(menu, "Access...").getAttribute("aria-disabled")).toBeNull();
    await user.click(item(menu, "Access..."));
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("keyboard", () => {
  test("a menu opens from the keyboard and closes with Escape", async () => {
    const user = userEvent.setup();
    render(<MenuBar />);
    const file = within(screen.getByRole("menubar")).getByRole("menuitem", { name: "File" });
    act(() => file.focus());
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menu")).toBeDefined();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  test("ArrowRight in an open menu moves to the next menu", async () => {
    const user = userEvent.setup();
    render(<MenuBar />);
    await openMenu(user, "File");
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Cut" })).toBeDefined());
  });
});

describe("View menu", () => {
  test("is disabled until the workspace is mounted, then New 3D Graphics Window opens the next window", async () => {
    const user = userEvent.setup();
    await mountWorkspace();
    const menu = await openMenu(user, "View");
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "Object Browser", "Timeline View", "Message Viewer", "New 3D Graphics Window", "New 2D Graphics Window", "Toolbars", "Full Screen",
    ]);
    await user.click(item(menu, "New 3D Graphics Window"));
    expect(useLayout.getState().listWindows().map((w) => w.title)).toContain("3D Graphics 2 - Earth");
  });

  test("without a workspace the window items are disabled", async () => {
    const user = userEvent.setup();
    render(<MenuBar />);
    const menu = await openMenu(user, "View");
    expect(item(menu, "Object Browser").getAttribute("aria-disabled")).toBe("true");
  });

  test("Object Browser focuses the open window; a closed one comes back", async () => {
    const user = userEvent.setup();
    await mountWorkspace();
    act(() => useLayout.getState().closePanel("objectBrowser"));
    expect(useLayout.getState().listWindows().map((w) => w.title)).not.toContain("Object Browser");
    const menu = await openMenu(user, "View");
    await user.click(item(menu, "Object Browser"));
    expect(useLayout.getState().listWindows().map((w) => w.title)).toContain("Object Browser");
  });

  test("Toolbars lists the five toolbars as checkboxes and toggles them through the layout store", async () => {
    const user = userEvent.setup();
    render(<MenuBar />);
    const menu = await openMenu(user, "View");
    await user.click(item(menu, "Toolbars"));
    const sub = await screen.findAllByRole("menu");
    const toolbars = within(sub[sub.length - 1]).getAllByRole("menuitemcheckbox");
    expect(toolbars.map((c) => [c.textContent, c.getAttribute("aria-checked")])).toEqual([
      ["Default", "true"], ["Animation", "true"], ["3D Graphics", "false"], ["3D Window Defaults", "false"], ["2D Window Defaults", "false"],
    ]);
    // เลือกด้วยคีย์บอร์ด (ผู้ใช้เลื่อนด้วยลูกศรได้ตาม spec §14): ลูกศรขวาเข้าเมนูย่อย ลงหนึ่งรายการคือ Animation
    await user.keyboard("{ArrowRight}{ArrowDown}{Enter}");
    expect(useLayout.getState().toolbars.animation).toBe(false);
    expect(useLayout.getState().toolbars.default).toBe(true);
  });

  test("a toolbar that is hidden shows unchecked next time", async () => {
    const user = userEvent.setup();
    render(<MenuBar />);
    act(() => useLayout.getState().setToolbar("graphics3d", true));
    const menu = await openMenu(user, "View");
    await user.click(item(menu, "Toolbars"));
    const sub = await screen.findAllByRole("menu");
    expect(within(sub[sub.length - 1]).getByRole("menuitemcheckbox", { name: "3D Graphics" }).getAttribute("aria-checked")).toBe("true");
  });

  test("Full Screen asks the page to go full screen with requestFullscreen", async () => {
    const user = userEvent.setup();
    const request = vi.fn(() => Promise.resolve());
    Object.defineProperty(document.documentElement, "requestFullscreen", { value: request, configurable: true });
    try {
      render(<MenuBar />);
      const menu = await openMenu(user, "View");
      await user.click(item(menu, "Full Screen"));
      expect(request).toHaveBeenCalledTimes(1);
    } finally {
      delete (document.documentElement as unknown as Record<string, unknown>).requestFullscreen;
    }
  });
});

describe("Window menu", () => {
  test("lists Windows..., Cascade, Tile Horizontally and Tile Vertically, then the open windows by number", async () => {
    const user = userEvent.setup();
    await mountWorkspace();
    const menu = await openMenu(user, "Window");
    const names = within(menu).getAllByRole("menuitem").map((m) => m.textContent);
    expect(names.slice(0, 4)).toEqual(["Windows...", "Cascade", "Tile Horizontally", "Tile Vertically"]);
    const open = useLayout.getState().listWindows();
    expect(names.slice(4)).toEqual(open.map((w, i) => `${i + 1} ${w.title}`));
    expect(open.length).toBe(5);
  });

  test("Windows... opens the Windows dialog", async () => {
    const user = userEvent.setup();
    await mountWorkspace();
    const menu = await openMenu(user, "Window");
    await user.click(item(menu, "Windows..."));
    expect(useLayout.getState().windowsDialogOpen).toBe(true);
  });

  test("choosing a window from the list focuses it", async () => {
    const user = userEvent.setup();
    await mountWorkspace();
    const menu = await openMenu(user, "Window");
    await user.click(item(menu, /^\d+ Message Viewer$/));
    expect(useLayout.getState().api?.activePanel?.id).toBe("messageViewer");
  });

  test("Tile Horizontally and Tile Vertically and Cascade run the layout commands", async () => {
    const user = userEvent.setup();
    await mountWorkspace();
    const tile = vi.spyOn(useLayout.getState(), "tile");
    useLayout.setState({ tile, cascade: vi.fn() });
    let menu = await openMenu(user, "Window");
    await user.click(item(menu, "Tile Horizontally"));
    expect(tile).toHaveBeenLastCalledWith("horizontal");
    menu = await openMenu(user, "Window");
    await user.click(item(menu, "Tile Vertically"));
    expect(tile).toHaveBeenLastCalledWith("vertical");
    menu = await openMenu(user, "Window");
    await user.click(item(menu, "Cascade"));
    expect(useLayout.getState().cascade).toHaveBeenCalledTimes(1);
  });

  test("a window whose title changes while the menu is open shows the new title in the list", async () => {
    const user = userEvent.setup();
    await mountWorkspace();
    const menu = await openMenu(user, "Window");
    expect(item(menu, /^\d+ Message Viewer$/)).toBeDefined();
    act(() => useLayout.getState().api!.getPanel("messageViewer")!.api.setTitle("Renamed Viewer"));
    expect(item(menu, /^\d+ Renamed Viewer$/)).toBeDefined(); // at once, not after some later layout event
    expect(within(menu).queryByRole("menuitem", { name: /^\d+ Message Viewer$/ })).toBeNull();
  });
});

describe("the menus read scenario state only through commands", () => {
  test("opening a scenario does not change which menus exist", () => {
    render(<MenuBar />);
    openScenario();
    expect(topLevel()).toHaveLength(9);
  });
});

describe("context menu", () => {
  function Target() {
    return (
      <CommandContextMenu entries={OBJECT_MENU}>
        <div data-testid="target" tabIndex={0}>target</div>
      </CommandContextMenu>
    );
  }

  test("opens on right click with the same items, disabled ones included", async () => {
    const user = userEvent.setup();
    render(<Target />);
    await user.pointer({ keys: "[MouseRight]", target: screen.getByTestId("target") });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "Properties", "Access...", "Report & Graph Manager...", "Zoom To", "Rename", "Delete",
    ]);
    expect(item(menu, "Access...").getAttribute("aria-disabled")).toBe("true");
  });

  test("the Sensor menu is the same data in a context menu", async () => {
    const user = userEvent.setup();
    render(
      <CommandContextMenu entries={objectMenuFor("Sensor")}>
        <div data-testid="target" tabIndex={0}>target</div>
      </CommandContextMenu>,
    );
    await user.pointer({ keys: "[MouseRight]", target: screen.getByTestId("target") });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Properties", "Access...", "Zoom To", "Rename", "Delete"]);
  });

  test("runs the command of the chosen item", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    registerCommand("object.rename", { label: "menu.object.rename", run });
    render(<Target />);
    await user.pointer({ keys: "[MouseRight]", target: screen.getByTestId("target") });
    await user.click(item(await screen.findByRole("menu"), "Rename"));
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("a disabled item shows its Thai reason", async () => {
    const user = userEvent.setup();
    render(<Target />);
    await user.pointer({ keys: "[MouseRight]", target: screen.getByTestId("target") });
    await user.hover(item(await screen.findByRole("menu"), "Report & Graph Manager..."));
    expect((await screen.findByRole("tooltip")).textContent).toBe(msg("tooltip.subtask4"));
  });
});

test("every visible label comes from labels.ts", () => {
  render(<MenuBar />);
  expect(topLevel()[0]).toBe(t("menu.file"));
});
