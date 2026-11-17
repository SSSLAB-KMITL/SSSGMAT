// หน้า Validation (access spec §7, งาน 14) กับ data fixture ของ build_fixture.py: ประวัติสองวันของ E2E (2026-11-09 Pass, 2026-11-10 Fail G22),
// ผลรายดวงของ 2026-11-10 หนึ่งไฟล์ และวันของ scenario รายวันที่ยังไม่มีผล (2026-11-11 Pending ไม่มีเวลาลองเพราะงานประจำวันปิด, 2026-11-12 Gave up)
// หน้านี้อ่านอย่างเดียว: ตลอด test ต้องไม่มีคำขอ /validate หรือ /daily/run (และ /orbits/fetch) ออกจากหน้าเว็บ

import type { Page, Request } from "@playwright/test";
import { msg } from "../../src/labels/messages.th";
import { expect, openScenario, test } from "./fixtures";

/** คำขอที่หน้านี้ห้ามส่ง (ตรวจหรือดาวน์โหลดจริง) */
const FORBIDDEN = /\/api\/(scenarios\/[^/]+\/validate|daily\/run|orbits\/fetch)(\?|$)/;

function watchForbidden(page: Page): string[] {
  const sent: string[] = [];
  page.on("request", (r: Request) => {
    if (FORBIDDEN.test(new URL(r.url()).pathname)) sent.push(`${r.method()} ${r.url()}`);
  });
  return sent;
}

async function openValidation(page: Page): Promise<void> {
  await page.getByRole("menuitem", { name: "Analysis", exact: true }).click();
  await page.getByRole("menuitem", { name: "Validation...", exact: true }).click();
}

const dailyGrid = (page: Page) => page.getByRole("grid", { name: "Daily Results" });
// ตารางรายวันเป็น role="grid" (ช่องเป็น gridcell) ช่องแรกคือวัน
const dayRow = (page: Page, day: string) => dailyGrid(page).locator("tr.val-row").filter({ has: page.locator("td:first-child", { hasText: new RegExp(`^${day}$`) }) });
const satTable = (page: Page) => page.getByRole("table", { name: "Satellite Results" });

test("validation page lists fixture days", async ({ page }) => {
  const forbidden = watchForbidden(page);
  await openScenario(page, "E2E");
  await openValidation(page);

  // วันใหม่สุดก่อน: วันที่ยังไม่มีผล (Gave up, Pending) แล้ววันที่ตรวจแล้ว
  await expect(dailyGrid(page).locator("tr.val-row")).toHaveCount(4);
  await expect(dailyGrid(page).locator("tr.val-row td:first-child")).toHaveText(["2026-11-12", "2026-11-11", "2026-11-10", "2026-11-09"]);
  await expect(dayRow(page, "2026-11-10")).toContainText("Fail");
  await expect(dayRow(page, "2026-11-10").locator("td").nth(3)).toHaveText("G22");
  await expect(dayRow(page, "2026-11-09")).toContainText("Pass");
  await expect(dayRow(page, "2026-11-11").locator(".val-result")).toHaveText(`Pending ${msg("validation.noRetry")}`);
  await expect(dayRow(page, "2026-11-12").locator(".val-result")).toHaveText(`Gave up ${msg("validation.gaveUpShort")}`);

  // คลิก 2026-11-10 = ตารางรายดวงของวันนั้น มี G22 ที่ Fail
  await dayRow(page, "2026-11-10").click();
  await expect(dayRow(page, "2026-11-10")).toHaveAttribute("aria-current", "true");
  const g22 = satTable(page).getByRole("row").filter({ has: page.getByRole("cell", { name: "G22", exact: true }) });
  await expect(g22).toHaveCount(1);
  await expect(g22.locator("td").last()).toHaveText("Fail");
  await expect(satTable(page).getByRole("cell", { name: "G01", exact: true })).toBeVisible();

  expect(forbidden, "the Validation page must not start a validation or a daily run").toEqual([]);
});

test("the daily table works from the keyboard: Tab in, arrows to a checked day, Enter opens it; Pending days do not open", async ({ page }) => {
  const forbidden = watchForbidden(page);
  await openScenario(page, "E2E");
  await openValidation(page);
  await expect(dailyGrid(page).locator("tr.val-row")).toHaveCount(4);

  // เริ่มจากปุ่มแรกของแถบเครื่องมือของหน้าต่าง แล้วกด Tab จนถึงแถว (แถวเป็นจุดหยุดเดียวของตาราง)
  await page.getByRole("toolbar", { name: "Validation" }).getByRole("button").first().focus();
  const focusedDay = () => page.evaluate(() => (document.activeElement?.closest("tr.val-row")?.querySelector("td")?.textContent ?? null));
  for (let i = 0; i < 6 && (await focusedDay()) === null; i++) await page.keyboard.press("Tab");
  expect(await focusedDay()).toBe("2026-11-12");

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  expect(await focusedDay()).toBe("2026-11-10");
  await page.keyboard.press("Enter");
  await expect(dayRow(page, "2026-11-10")).toHaveAttribute("aria-current", "true");
  await expect(satTable(page).getByRole("cell", { name: "G22", exact: true })).toBeVisible();

  // Pending เข้าถึงได้แต่เปิดไม่ได้: ตารางรายดวงยังเป็นของ 2026-11-10
  await page.keyboard.press("ArrowUp");
  expect(await focusedDay()).toBe("2026-11-11");
  await page.keyboard.press("Enter");
  await page.keyboard.press(" ");
  await expect(dayRow(page, "2026-11-11")).not.toHaveAttribute("aria-current", "true");
  await expect(dayRow(page, "2026-11-10")).toHaveAttribute("aria-current", "true");
  await expect(satTable(page).getByRole("cell", { name: "G22", exact: true })).toBeVisible();

  // End = วันเก่าสุด, Home = วันใหม่สุด
  await page.keyboard.press("End");
  expect(await focusedDay()).toBe("2026-11-09");
  await page.keyboard.press("Home");
  expect(await focusedDay()).toBe("2026-11-12");

  expect(forbidden, "the Validation page must not start a validation or a daily run").toEqual([]);
});
