// Insert STK Objects -> Satellite -> From Satellite Catalog: เลือกสองดวง + Create Constellation from Selected -> ต้นไม้มี object ใหม่
// ใช้ scenario ว่าง E2E_EMPTY (spec นี้แก้มัน; ไม่มี spec อื่นใช้)

import { expect, openScenario, test, treeRow } from "./fixtures";

test("two satellites from the catalog and a constellation appear in the Object Browser", async ({ page }) => {
  await openScenario(page, "E2E_EMPTY");
  await expect(treeRow(page, "*/Satellite/E11")).toHaveCount(0);

  await page.getByRole("menuitem", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "New...", exact: true }).click();

  await page.getByRole("radio", { name: "Satellite", exact: true }).check();
  await page.getByRole("radio", { name: "From Satellite Catalog" }).check();
  await page.getByRole("button", { name: "Insert...", exact: true }).click();

  // Search Satellite Catalog: เลือก E11 กับ E14 (Ctrl คลิกเพิ่ม)
  const grid = page.getByRole("grid", { name: "Search Satellite Catalog" });
  await expect(grid).toBeVisible();
  await grid.getByRole("row", { name: /^E11 / }).click();
  await grid.getByRole("row", { name: /^E14 / }).click({ modifiers: ["ControlOrMeta"] });
  await expect(page.getByText("เลือกแล้ว 2 ดวง")).toBeVisible();

  await page.getByRole("checkbox", { name: "Create Constellation from Selected" }).check();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Mine");
  await page.getByRole("button", { name: "Insert", exact: true }).click();

  await expect(treeRow(page, "*/Constellation/Mine")).toBeVisible();
  await expect(treeRow(page, "*/Satellite/E11")).toBeVisible();
  await expect(treeRow(page, "*/Satellite/E14")).toBeVisible();
});
