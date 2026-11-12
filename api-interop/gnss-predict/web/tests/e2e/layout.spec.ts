// Layout (spec §4.2, เกณฑ์ข้อ 5): การจัดวางตั้งต้นตามภาพจำลอง และ Save แล้วเปิดใหม่ได้ layout เดิม
//   เมนู -> แถบ Default + Animation -> (Object Browser | 3D | 2D) -> (Timeline View | Message Viewer) -> แถบสถานะ

import type { Page } from "@playwright/test";
import { expect, openScenario, postJson, test } from "./fixtures";

const tab = (page: Page, id: string) => page.locator(`[data-tab-panel-id="${id}"]`);

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
const box = async (page: Page, selector: string): Promise<Box> => {
  const b = await page.locator(selector).first().boundingBox();
  expect(b, selector).not.toBeNull();
  return b as Box;
};

test("the default arrangement follows spec 4.2", async ({ page }) => {
  await openScenario(page, "E2E");
  await expect(tab(page, "graphics3d")).toHaveText("3D Graphics 1 - Earth");
  await expect(tab(page, "graphics2d")).toHaveText("2D Graphics 1 - Earth");

  const menubar = await box(page, '[role="menubar"]');
  const toolbarDefault = await box(page, '[role="toolbar"][aria-label="Default"]');
  const toolbarAnimation = await box(page, '[role="toolbar"][aria-label="Animation"]');
  const objectBrowser = await box(page, '[data-tab-panel-id="objectBrowser"]');
  const t3d = await box(page, '[data-tab-panel-id="graphics3d"]');
  const t2d = await box(page, '[data-tab-panel-id="graphics2d"]');
  const timeline = await box(page, '[data-tab-panel-id="timelineView"]');
  const messages = await box(page, '[data-tab-panel-id="messageViewer"]');
  const status = await box(page, ".statusbar");

  // บนลงล่าง: เมนู, แถบเครื่องมือ (Default + Animation), หน้าต่าง, แถบสถานะ
  expect(menubar.y).toBeLessThan(toolbarDefault.y);
  expect(toolbarDefault.y + toolbarDefault.height).toBeLessThanOrEqual(objectBrowser.y);
  expect(toolbarAnimation.y).toBeGreaterThanOrEqual(menubar.y + menubar.height);
  expect(timeline.y).toBeLessThan(status.y);

  // แถวบน: Object Browser | 3D | 2D เรียงซ้ายไปขวา แถบชื่ออยู่แถวเดียวกัน
  expect(objectBrowser.x).toBeLessThan(t3d.x);
  expect(t3d.x).toBeLessThan(t2d.x);
  expect(Math.abs(objectBrowser.y - t3d.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(t3d.y - t2d.y)).toBeLessThanOrEqual(2);

  // แถวล่าง: Timeline View กับ Message Viewer เป็นแท็บร่วมกัน อยู่ใต้หน้าต่างบน Timeline View เห็นก่อน
  expect(Math.abs(timeline.y - messages.y)).toBeLessThanOrEqual(2);
  expect(timeline.x).toBeLessThan(messages.x);
  expect(timeline.y).toBeGreaterThan(t3d.y + 100);
  await expect(tab(page, "timelineView")).toHaveClass(/dv-active-tab/);
  await expect(tab(page, "messageViewer")).toHaveClass(/dv-inactive-tab/);
});

test("closing the Timeline View, Save and reload restore the same arrangement", async ({ page, request }) => {
  // สำเนาของ E2E_NORES: Save เขียน workbook.json ซึ่งไม่ควรกระทบ E2E ที่ spec อื่นใช้
  const name = `layout_${Date.now().toString(36)}`;
  expect((await postJson(request, "/api/scenarios/E2E_NORES/copy", { new_name: name })).ok()).toBe(true);

  await openScenario(page, name);
  await expect(tab(page, "timelineView")).toBeVisible();
  // กรอบของกลุ่ม (พื้นที่ทั้งหมดของหน้าต่างรวมแถบชื่อ) ที่แท็บนั้นอยู่
  const rect = async (id: string): Promise<Box> => {
    const b = await page.locator(".dv-groupview").filter({ has: tab(page, id) }).first().boundingBox();
    expect(b, `group of ${id}`).not.toBeNull();
    return b as Box;
  };

  // ปิด Timeline View ด้วยปุ่มปิดบนแถบชื่อ แล้ว Ctrl+S
  await tab(page, "timelineView").locator(".dv-default-tab-action").click();
  await expect(tab(page, "timelineView")).toHaveCount(0);
  const before = { ob: await rect("objectBrowser"), t3d: await rect("graphics3d"), t2d: await rect("graphics2d"), mv: await rect("messageViewer") };
  await page.keyboard.press("Control+s");
  await expect.poll(async () => (await request.get(`/api/scenarios/${name}/workbook`)).status()).toBe(200);

  await page.reload();
  await expect(page.getByRole("treeitem").first()).toBeVisible();
  await expect(tab(page, "messageViewer")).toBeVisible();
  await expect(tab(page, "timelineView")).toHaveCount(0);

  // หน้าต่างอื่นอยู่ที่เดิม (ความคลาดเคลื่อนจากการปัดเศษ 2 พิกเซล)
  const after = { ob: await rect("objectBrowser"), t3d: await rect("graphics3d"), t2d: await rect("graphics2d"), mv: await rect("messageViewer") };
  for (const key of ["ob", "t3d", "t2d", "mv"] as const) {
    for (const edge of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(after[key][edge] - before[key][edge]), `${key}.${edge}`).toBeLessThanOrEqual(2);
    }
  }
});
