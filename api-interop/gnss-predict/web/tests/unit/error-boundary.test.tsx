// หน้าต่างที่โยน exception ตอนวาดต้องไม่ทำให้ทั้งพื้นที่ทำงานว่าง (และค่าที่ยังไม่ได้ Apply ของหน้าต่างอื่นหาย):
// เนื้อของหน้าต่าง dockview แต่ละบานอยู่ใน error boundary ของตัวเอง แสดงข้อความไทย ปุ่ม Retry / Close และแจ้ง Message Viewer

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { getPanelDef, registerPanel, type PanelDef } from "../../src/layout/panels";
import { useLayout } from "../../src/stores/layout";
import { useMessages } from "../../src/stores/messages";
import { Workspace } from "../../src/Workspace";

const st = () => useLayout.getState();
const panelEl = (id: string): HTMLElement => {
  const panel = st().api?.getPanel(id);
  if (panel === undefined) throw new Error(`no panel ${id}`);
  return panel.view.content.element;
};

let original: PanelDef;
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  useLayout.setState(useLayout.getInitialState(), true);
  useMessages.setState(useMessages.getInitialState(), true);
  original = getPanelDef("objectBrowser")!;
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined); // React logs the caught error
});
afterEach(() => {
  cleanup();
  registerPanel("objectBrowser", original);
  consoleError.mockRestore();
});

async function mountWith(component: PanelDef["component"]) {
  registerPanel("objectBrowser", { ...original, component });
  render(<Workspace />);
  await waitFor(() => expect(st().api).not.toBeNull());
}

describe("a window that throws while rendering", () => {
  test("shows the Thai message in that window only; the other windows still render", async () => {
    await mountWith(() => {
      throw new Error("boom");
    });
    const alert = await within(panelEl("objectBrowser")).findByRole("alert");
    expect(alert.textContent).toContain(msg("panel.crashed"));
    expect(within(panelEl("messageViewer")).getByText(msg("panel.placeholder"))).toBeDefined();
    expect(within(panelEl("timelineView")).getByText(msg("panel.placeholder"))).toBeDefined();
    expect(st().api?.panels.map((p) => p.id).sort()).toEqual(["graphics2d", "graphics3d", "messageViewer", "objectBrowser", "timelineView"]);
  });

  test("reports the error in the Message Viewer with the window name", async () => {
    await mountWith(() => {
      throw new Error("boom");
    });
    await waitFor(() => expect(useMessages.getState().items.map((m) => m.code)).toContain("PANEL_CRASH"));
    const logged = useMessages.getState().items.find((m) => m.code === "PANEL_CRASH")!;
    expect(logged.level).toBe("error");
    expect(logged.text).toBe(msg("panel.crashedLog", { window: t("window.objectBrowser"), message: "boom" }));
  });

  test("Retry draws the window again", async () => {
    let fail = true;
    await mountWith(() => {
      if (fail) throw new Error("boom");
      return <div>works now</div>;
    });
    const alert = await within(panelEl("objectBrowser")).findByRole("alert");
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: t("dialog.retry") }));
    expect(await within(panelEl("objectBrowser")).findByText("works now")).toBeDefined();
  });

  test("Close closes that window", async () => {
    await mountWith(() => {
      throw new Error("boom");
    });
    const alert = await within(panelEl("objectBrowser")).findByRole("alert");
    act(() => fireEvent.click(within(alert).getByRole("button", { name: t("dialog.windows.close") })));
    await waitFor(() => expect(st().api?.getPanel("objectBrowser")).toBeUndefined());
    expect(st().api?.getPanel("messageViewer")).toBeDefined();
  });

  test("a window that throws later (after an update) is caught the same way", async () => {
    let fail = false;
    let bump: () => void = () => undefined;
    await mountWith(function Flaky() {
      const [n, setN] = React.useState(0);
      bump = () => setN((x) => x + 1);
      if (fail) throw new Error(`late ${n}`);
      return <div>fine</div>;
    });
    expect(await within(panelEl("objectBrowser")).findByText("fine")).toBeDefined();
    fail = true;
    act(() => bump());
    expect((await within(panelEl("objectBrowser")).findByRole("alert")).textContent).toContain(msg("panel.crashed"));
    expect(screen.getAllByText(msg("panel.placeholder")).length).toBeGreaterThan(0);
  });
});
