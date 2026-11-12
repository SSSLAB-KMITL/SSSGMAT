// Timeline View (spec §10): คลิกขวาที่ Global Time Bar -> Set Animation Time to Here ตั้งเวลา animation ตรงตำแหน่งที่คลิก (ต่างไม่เกิน 1 pixel)

import { animationTime, expect, openScenario, parseUtcg, test } from "./fixtures";
import { BAR_H, needsScrollbar, plotOf } from "../../src/windows/TimelineView/layout";
import { xToTime } from "../../src/windows/TimelineView/scale";

const START_MS = Date.UTC(2026, 10, 10, 0, 0, 0);
const STOP_MS = Date.UTC(2026, 10, 10, 6, 0, 0);

test("Set Animation Time to Here puts the clock where the Global Time Bar was clicked", async ({ page }) => {
  await openScenario(page, "E2E");
  const canvas = page.locator("canvas.tl-canvas");
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const rows = await page.locator("[data-row]").count();
  const size = { width: box.width, height: box.height };
  const plot = plotOf(size, needsScrollbar(size, rows));

  // 3/4 ของแกนเวลา ในแถว Global Time Bar (BAR_H บนสุดของ canvas)
  const x = plot.left + plot.width * 0.75;
  const bounds = [START_MS / 1000, STOP_MS / 1000] as const;
  const expectedMs = xToTime(x - plot.left, bounds[0], bounds[1], plot.width) * 1000;
  const msPerPixel = ((bounds[1] - bounds[0]) * 1000) / plot.width;

  await canvas.click({ button: "right", position: { x, y: BAR_H / 2 } });
  await page.getByRole("menuitem", { name: "Set Animation Time to Here" }).click();

  await expect.poll(async () => Math.abs(parseUtcg((await animationTime(page).textContent()) ?? "") - expectedMs)).toBeLessThanOrEqual(msPerPixel);
});
