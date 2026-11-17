// Animation (spec §6.1): Start เดินเวลา, Pause หยุด, Step Forward เดิน 1 step (60 วินาที) พอดี, Reset กลับ Animation Start Time

import { currentTimeField, expect, openScenario, parseUtcg, test, toolButton } from "./fixtures";

const START_TEXT = "10 Nov 2026 00:00:00.000 UTCG";

test("Start moves the clock, Step Forward adds one time step and Reset returns to the start time", async ({ page }) => {
  await openScenario(page, "E2E");
  const time = currentTimeField(page);
  await expect(time).toHaveValue(START_TEXT);

  // Start: เวลาเปลี่ยน (เกณฑ์ 2 วินาทีอยู่ที่ perf.spec ที่นี่ใช้ timeout ตั้งต้น: เครื่องที่หนักไม่ทำให้ test พฤติกรรมนี้ล้ม)
  await toolButton(page, "Start").click();
  await expect(time).not.toHaveValue(START_TEXT);

  // Pause: เวลานิ่ง (ค่าที่ throttle ไว้ตามทันแล้วไม่เปลี่ยนอีก)
  await toolButton(page, "Pause").click();
  let settled = "";
  await expect
    .poll(async () => {
      const now = await time.inputValue();
      const same = now === settled;
      settled = now;
      return same;
    }, { intervals: [400] })
    .toBe(true);
  const paused = parseUtcg(await time.inputValue());

  // Step Forward: Time Step ตั้งต้นของ scenario = 60 วินาที
  await expect(page.getByRole("textbox", { name: "Time Step" })).toHaveValue("60.00 sec");
  await toolButton(page, "Step Forward").click();
  await expect.poll(async () => parseUtcg(await time.inputValue()) - paused).toBe(60_000);

  // Reset: Animation Start Time
  await toolButton(page, "Reset").click();
  await expect(time).toHaveValue(START_TEXT);
});
