// Message Viewer (spec §11): ข้อความจาก server ขึ้นทาง SSE; Clear this Tab ลบเฉพาะแท็บที่สั่ง
//
// POST /propagate ของ E2E: ผล current อยู่แล้ว engine จึงคืนทันทีโดยไม่ใช้ GMAT (GMAT_BIN=/nonexistent) และ job ส่งข้อความที่เก็บใน manifest ของผลนั้น
// (SAT_FLAGGED ของดาวที่ติดธง) ออกทาง SSE

import { expect, openScenario, test, WRITE_HEADERS } from "./fixtures";

const count = async (page: import("@playwright/test").Page, tab: string): Promise<number> => {
  const label = await page.getByRole("tab", { name: new RegExp(`^${tab} \\(\\d+\\)$`) }).textContent();
  return Number(/\((\d+)\)/.exec(label ?? "")![1]);
};

test("messages from a propagate job reach the Message Viewer and Clear this Tab clears only its tab", async ({ page, request }) => {
  await openScenario(page, "E2E");
  await page.getByRole("tab", { name: "Message Viewer" }).click();
  const before = await count(page, "All Messages");

  const reply = await request.post("/api/scenarios/E2E/propagate", { headers: WRITE_HEADERS });
  expect(reply.status()).toBe(202);

  // ข้อความใหม่ขึ้นภายใน 10 วินาที
  await expect.poll(() => count(page, "All Messages"), { timeout: 10_000 }).toBeGreaterThan(before);
  await expect(page.getByRole("row").filter({ hasText: "SAT_FLAGGED" }).first()).toBeVisible();

  // ข้อความ SAT_FLAGGED ระดับ info อยู่ในแท็บ Infos: Clear this Tab ที่นั่งลบเฉพาะแท็บนั้น
  const all = await count(page, "All Messages");
  const infos = await count(page, "Infos");
  expect(infos).toBeGreaterThan(0);
  await page.getByRole("tab", { name: /^Infos \(/ }).click();
  await page.getByRole("button", { name: "Clear this Tab" }).click();
  await expect(page.getByRole("tab", { name: "Infos (0)" })).toBeVisible();
  expect(await count(page, "All Messages")).toBe(all);
  await page.getByRole("tab", { name: /^All Messages \(/ }).click();
  await expect(page.getByRole("row").filter({ hasText: "SAT_FLAGGED" }).first()).toBeVisible();
});
