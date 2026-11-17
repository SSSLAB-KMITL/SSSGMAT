// ปุ่มซ่อนเส้นวงโคจร (task 13c): Show Orbits ของหน้าต่าง 3D และ Show Ground Tracks ของหน้าต่าง 2D (ตัวเลือกของหน้าต่าง ไม่แตะค่าของ object)
// ปุ่มบนแถบ 3D/2D Window Defaults สลับตัวเลือก test hook pathCount นับเส้นวงโคจรที่หน้าต่าง 3D ตัวแรกวาดอยู่ overlays2d().groundTracks ของหน้าต่าง 2D
// ไม่ Save workbook: ตัวเลือกไม่ไปถึงไฟล์ของ fixture

import type { Locator, Page } from "@playwright/test";
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

const threeDCanvas = (page: Page): Locator => page.getByTestId("g3d-view").locator("canvas").first();
/** มุมซ้ายบนของภาพ 3D: อวกาศ ไม่มีดาวหรือ Facility (Home View มองลงที่ THBK ตรงกลางภาพ) */
const EMPTY = { x: 8, y: 8 };
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

// เมนูคลิกขวาของหน้าต่างใน browser จริง (fix round 1): Chromium ส่ง contextmenu ตามลำดับของระบบ (macOS/Linux ตอนกดปุ่ม, Windows ตอนปล่อย)
test("a right-click on empty space in the 3D window opens its menu, and Show Orbits there toggles the orbit paths", async ({ page }) => {
  await openScenario(page, "E2E");
  await waitForScene(page);
  await expect.poll(() => pathCount(page), { message: "orbit paths in 3D" }).toBeGreaterThan(0);
  const paths = await pathCount(page);
  const item = page.getByRole("menuitemcheckbox", { name: "Show Orbits", exact: true });

  await threeDCanvas(page).click({ position: EMPTY, button: "right" });
  await expect(item).toBeVisible();
  await expect(item).toHaveAttribute("aria-checked", "true");
  await item.click();
  await expect(item).toBeHidden();
  await expect.poll(() => pathCount(page)).toBe(0);

  await threeDCanvas(page).click({ position: EMPTY, button: "right" });
  await expect(item).toHaveAttribute("aria-checked", "false");
  await item.click();
  await expect.poll(() => pathCount(page)).toBe(paths);
});

test("a right-drag in the 3D window zooms the camera and opens no menu", async ({ page }) => {
  await openScenario(page, "E2E");
  await waitForScene(page);
  const box = (await threeDCanvas(page).boundingBox())!;
  const camera = () => page.evaluate(() => window.__gnssStudioTest!.cameraPosition());
  const before = (await camera())!;
  expect(before).not.toBeNull();
  // กดที่อวกาศ (ไม่ชี้ object: ไม่มีเมนูของ object) แล้วลากลง 60 px
  const x = box.x + EMPTY.x + 30;
  const y = box.y + EMPTY.y + 30;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(x, y + 60, { steps: 10 });
  await page.mouse.up({ button: "right" });
  await expect
    .poll(async () => {
      const now = (await camera())!;
      return Math.hypot(now[0] - before[0], now[1] - before[1], now[2] - before[2]);
    }, { message: "camera moved by the right-drag zoom" })
    .toBeGreaterThan(1000);
  await expect(page.getByRole("menu")).toHaveCount(0);
});
