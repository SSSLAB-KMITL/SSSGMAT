import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DockviewApi } from "dockview-react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { t } from "../../src/labels/labels";
import { useLayout } from "../../src/stores/layout";
import { Workspace } from "../../src/Workspace";

const st = () => useLayout.getState();
const floatBox = (api: DockviewApi) =>
  api.toJSON().floatingGroups![0].position as unknown as { top: number; left: number; width: number; height: number };
const apiOf = (): DockviewApi => {
  const api = st().api;
  if (api === null) throw new Error("the workspace is not mounted");
  return api;
};

async function openDialog() {
  render(<Workspace />);
  await waitFor(() => expect(st().api).not.toBeNull());
  act(() => st().openWindowsDialog());
  return screen.getByRole("dialog");
}

const rowOf = (dialog: HTMLElement, title: string) => within(dialog).getByRole("row", { name: new RegExp(`^${title}`) });
const button = (dialog: HTMLElement, key: "activate" | "integrate" | "center" | "close") =>
  within(dialog).getByRole("button", { name: t(`dialog.windows.${key}`) }) as HTMLButtonElement;

beforeEach(() => useLayout.setState(useLayout.getInitialState(), true));
afterEach(cleanup);

describe("Windows... dialog", () => {
  test("lists every window with its title and type under the columns Window and Type", async () => {
    const dialog = await openDialog();
    expect(within(dialog).getByRole("heading", { name: t("window.windows") })).toBeDefined();
    expect(within(dialog).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([t("dialog.windows.window"), t("dialog.windows.type")]);
    const rows = within(dialog).getAllByRole("row").slice(1);
    const cells = rows.map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent));
    expect(cells).toHaveLength(5);
    expect(cells).toEqual(expect.arrayContaining([
      ["Object Browser", "Dockable"], ["3D Graphics 1 - Earth", "Integrated"], ["2D Graphics 1 - Earth", "Integrated"],
      ["Timeline View", "Dockable"], ["Message Viewer", "Dockable"],
    ]));
  });

  test("the buttons are Activate, Integrate, Center and Close, then OK", async () => {
    const dialog = await openDialog();
    expect(within(dialog).getAllByRole("button").map((b) => b.textContent)).toEqual([
      t("dialog.windows.activate"), t("dialog.windows.integrate"), t("dialog.windows.center"), t("dialog.windows.close"), t("dialog.ok"),
    ]);
  });

  test("it opens with the active window selected", async () => {
    const dialog = await openDialog();
    const active = apiOf().activePanel;
    expect(active).toBeDefined();
    const selected = within(dialog).getAllByRole("row").filter((r) => r.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0].querySelector("td")?.textContent).toBe(active!.title);
    expect(document.activeElement).toBe(selected[0]); // โฟกัสอยู่ที่แถวที่เลือก
  });

  test("with no window selected every action button is disabled except OK", async () => {
    const dialog = await openDialog();
    fireEvent.click(rowOf(dialog, "2D Graphics 1"));
    fireEvent.click(button(dialog, "close")); // ปิดหน้าต่างที่เลือกอยู่ ไม่เหลือแถวที่เลือก
    for (const key of ["activate", "integrate", "center", "close"] as const) expect(button(dialog, key).disabled, key).toBe(true);
    expect((within(dialog).getByRole("button", { name: t("dialog.ok") }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("Integrate and Center are only offered where they make sense", async () => {
    const dialog = await openDialog();
    act(() => void st().openPanel("propertiesBrowser"));
    fireEvent.click(rowOf(dialog, "Object Browser"));
    expect(button(dialog, "integrate").disabled).toBe(false);
    expect(button(dialog, "center").disabled).toBe(true); // ไม่ใช่ Floating
    fireEvent.click(rowOf(dialog, "3D Graphics 1"));
    expect(button(dialog, "integrate").disabled).toBe(true); // Integrated อยู่แล้ว
    expect(button(dialog, "center").disabled).toBe(true);
    fireEvent.click(rowOf(dialog, "Properties Browser"));
    expect(button(dialog, "integrate").disabled).toBe(false);
    expect(button(dialog, "center").disabled).toBe(false);
    expect(button(dialog, "activate").disabled).toBe(false);
    expect(button(dialog, "close").disabled).toBe(false);
  });

  test("Activate makes the selected window the active one", async () => {
    const dialog = await openDialog();
    fireEvent.click(rowOf(dialog, "Message Viewer"));
    fireEvent.click(button(dialog, "activate"));
    expect(apiOf().activePanel?.id).toBe("messageViewer");
    fireEvent.click(rowOf(dialog, "3D Graphics 1"));
    fireEvent.click(button(dialog, "activate"));
    expect(apiOf().activePanel?.id).toBe("graphics3d");
  });

  test("Integrate moves the window into the centre area and the table shows the new type", async () => {
    const dialog = await openDialog();
    fireEvent.click(rowOf(dialog, "Object Browser"));
    fireEvent.click(button(dialog, "integrate"));
    expect(apiOf().getPanel("objectBrowser")?.api.location.type).toBe("grid");
    await waitFor(() => expect(within(rowOf(dialog, "Object Browser")).getByText("Integrated")).toBeDefined());
    expect(button(dialog, "integrate").disabled).toBe(true);
  });

  test("Center puts a floating window back in the middle of the workspace", async () => {
    const dialog = await openDialog();
    const api = apiOf();
    act(() => api.layout(1600, 1200, true));
    let id = "";
    act(() => {
      id = st().openPanel("propertiesBrowser");
    });
    const panel = api.getPanel(id)!;
    act(() => api.addFloatingGroup(panel, { x: 0, y: 0, width: 300, height: 200 })); // ลากไปมุมจอ
    expect(floatBox(api)).toMatchObject({ left: 0, top: 0 });
    fireEvent.click(rowOf(dialog, "Properties Browser"));
    fireEvent.click(button(dialog, "center"));
    const box = floatBox(api);
    expect(box.left + box.width / 2).toBeCloseTo(api.width / 2, 0);
    expect(box.top + box.height / 2).toBeCloseTo(api.height / 2, 0);
    expect(api.getPanel(id)?.api.location.type).toBe("floating");
  });

  test("Close closes the selected window and removes its row", async () => {
    const dialog = await openDialog();
    fireEvent.click(rowOf(dialog, "2D Graphics 1"));
    fireEvent.click(button(dialog, "close"));
    expect(apiOf().getPanel("graphics2d")).toBeUndefined();
    await waitFor(() => expect(within(dialog).queryByRole("row", { name: /^2D Graphics 1/ })).toBeNull());
    expect(button(dialog, "close").disabled).toBe(true); // ไม่มีแถวที่เลือกแล้ว
  });

  test("rows follow windows that open while the dialog is showing", async () => {
    const dialog = await openDialog();
    act(() => void st().newGraphicsWindow("graphics3d"));
    expect(await within(dialog).findByRole("row", { name: /^3D Graphics 2 - Earth/ })).toBeDefined();
  });

  test("a window whose title changes shows the new title (a title-only change must reach the list)", async () => {
    const dialog = await openDialog();
    expect(rowOf(dialog, "Message Viewer")).toBeDefined();
    act(() => apiOf().getPanel("messageViewer")!.api.setTitle("Renamed Viewer"));
    expect(within(dialog).getByRole("row", { name: /^Renamed Viewer/ })).toBeDefined(); // at once, not after some later layout event
    expect(within(dialog).queryByRole("row", { name: /^Message Viewer/ })).toBeNull();
  });

  test("OK closes the dialog", async () => {
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(st().windowsDialogOpen).toBe(false);
  });

  test("Escape closes it too", async () => {
    const dialog = await openDialog();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(st().windowsDialogOpen).toBe(false);
  });
});
