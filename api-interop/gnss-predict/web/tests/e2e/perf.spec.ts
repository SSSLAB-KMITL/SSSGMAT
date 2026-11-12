// W13 / เกณฑ์ข้อ 1-2: เวลาโหลดและจำนวนเฟรม ข้ามเว้นแต่ตั้ง GNSS_E2E_PERF_URL (URL ของ scenario รายวันจริงบน server ที่เปิดไว้เอง ดู README หัวข้อ 9)
//   GNSS_E2E_PERF_URL="http://127.0.0.1:8767/?sc=acc_20261111&test" npx playwright test perf.spec.ts --headed
// ผล headless ไม่ใช่ตัวตัดสิน (เกณฑ์ข้อ 2 ขึ้นกับเครื่องและ GPU)

import { expect, test, toolButton } from "./fixtures";

const URL_UNDER_TEST = process.env.GNSS_E2E_PERF_URL;
const LOAD_BUDGET_MS = 3000;
const FRAMES_IN_5S = 150;

test.skip(!URL_UNDER_TEST, "set GNSS_E2E_PERF_URL to measure the performance criteria");

test("daily scenario loads within 3 s and animates at 30 fps", async ({ page }) => {
  test.setTimeout(120_000);
  const started = Date.now();
  await page.goto(URL_UNDER_TEST!);
  await expect.poll(() => page.evaluate(() => window.__gnssStudioTest?.sceneLoadedAt() ?? null), { timeout: 60_000, intervals: [50] }).not.toBeNull();
  const loadedAt = await page.evaluate(() => window.__gnssStudioTest!.sceneLoadedAt()!);
  // sceneLoadedAt เป็นเวลาบนนาฬิกาของหน้า (performance.now) นับจากเปิดหน้า; อีกค่าวัดจากฝั่ง test ตั้งแต่สั่งเปิดหน้า
  const wallMs = Date.now() - started;
  console.log(`PERF load: sceneLoadedAt=${Math.round(loadedAt)} ms, wall (goto -> scene polled)=${wallMs} ms`);

  await toolButton(page, "Start").click();
  const before = await page.evaluate(() => window.__gnssStudioTest!.frameCount());
  await page.waitForTimeout(5000);
  const frames = (await page.evaluate(() => window.__gnssStudioTest!.frameCount())) - before;
  console.log(`PERF frames in 5 s: ${frames} (${(frames / 5).toFixed(1)} fps)`);

  expect(loadedAt, "criterion 1: scene ready within 3000 ms").toBeLessThanOrEqual(LOAD_BUDGET_MS);
  expect(frames, "criterion 2: at least 150 frames in 5 s").toBeGreaterThanOrEqual(FRAMES_IN_5S);
});
