// ปุ่มซ่อนเส้นวงโคจร (task 13c): Show Orbits ของหน้าต่าง 3D และ Show Ground Tracks ของหน้าต่าง 2D (ตัวเลือกของหน้าต่าง ไม่แตะค่าของ object)
// ปุ่มบนแถบ 3D/2D Window Defaults สลับตัวเลือก test hook pathCount นับเส้นวงโคจรที่หน้าต่าง 3D ตัวแรกวาดอยู่ overlays2d().groundTracks ของหน้าต่าง 2D
// ไม่ Save workbook: ตัวเลือกไม่ไปถึงไฟล์ของ fixture

import type { Page } from "@playwright/test";
import { expect, openScenario, test, waitForScene } from "./fixtures";

/** เปิดแถบเครื่องมือจาก View → Toolbars (ซ่อนอยู่ตั้งต้น) */
async function showToolbar(page: Page, name: string) {
  const toolbar = page.getByRole("toolbar", { name });
  if (!(await toolbar.isVisible())) {
    await page.getByRole("menuitem", { name: "View", exact: true }).click();
    await page.getByRole("menuitem", { name: "Toolbars", exact: true }).click();
    await page.getByRole("menuitemcheckbox", { name, exact: true }).click();
  }
  await expect(toolbar).toBeVisible();
  return toolbar;
}

const pathCount = (page: Page) => page.evaluate(() => window.__gnssStudioTest!.pathCount());
const groundTracks = (page: Page) => page.evaluate(() => window.__gnssStudioTest!.overlays2d()?.groundTracks ?? -1);

test("Show Orbits hides every orbit path of the 3D window and brings them back; Show Ground Tracks does the same in 2D", async ({ page }) => {
  await openScenario(page, "E2E");
  await waitForScene(page);
  await expect.poll(() => pathCount(page), { message: "orbit paths in 3D" }).toBeGreaterThan(0);
  const paths = await pathCount(page);
  await expect.poll(() => groundTracks(page), { message: "ground tracks in 2D" }).toBeGreaterThan(0);
  const tracks = await groundTracks(page);

  const bar3d = await showToolbar(page, "3D Window Defaults");
  const orbits = bar3d.getByRole("button", { name: "Show Orbits", exact: true });
  await expect(orbits).toHaveAttribute("aria-pressed", "true");
  await orbits.click();
  await expect(orbits).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => pathCount(page)).toBe(0);
  expect(await page.evaluate(() => window.__gnssStudioTest!.labelShown("G01"))).toBe(true); // ดาวยังอยู่
  expect(await groundTracks(page)).toBe(tracks); // หน้าต่าง 2D ไม่ถูกแตะ
  await orbits.click();
  await expect.poll(() => pathCount(page)).toBe(paths);

  const bar2d = await showToolbar(page, "2D Window Defaults");
  const ground = bar2d.getByRole("button", { name: "Show Ground Tracks", exact: true });
  await ground.click();
  await expect(ground).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => groundTracks(page)).toBe(0);
  expect(await pathCount(page)).toBe(paths);
  await ground.click();
  await expect.poll(() => groundTracks(page)).toBe(tracks);
});
