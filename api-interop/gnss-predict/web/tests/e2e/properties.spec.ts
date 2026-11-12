// Properties Browser (spec §8, §9): แก้สีของดาว และ Show Labels ของ Scenario แล้วภาพ 3D เปลี่ยนตาม
// spec นี้แก้ scenario E2E แล้วคืนค่าเดิมตอนจบ (spec อื่นใช้ E2E ด้วย)

import { expect, openObjectProperties, openScenario, propertiesWindow, saveScenario, test, treeRow, waitForScene } from "./fixtures";

test.describe("Properties Browser", () => {
  let restore: () => Promise<void>;

  test.beforeEach(async ({ request }) => {
    restore = await saveScenario(request, "E2E");
  });
  test.afterEach(async () => {
    await restore();
  });

  test("changing the colour of G01 and applying recolours the entity", async ({ page }) => {
    await openScenario(page, "E2E");
    await waitForScene(page);
    expect(await page.evaluate(() => window.__gnssStudioTest!.entityColor("G01"))).not.toBe("#00ff00");

    await openObjectProperties(page, "*/Satellite/G01");
    await page.getByRole("tab", { name: "2D Graphics - Attributes" }).click();
    await page.getByLabel("Color", { exact: true }).fill("#00ff00");
    await propertiesWindow(page, "G01").getByRole("button", { name: "Apply", exact: true }).click();

    await expect.poll(() => page.evaluate(() => window.__gnssStudioTest!.entityColor("G01"))).toBe("#00ff00");
  });

  test("turning Show Labels off in the Scenario properties hides the labels", async ({ page }) => {
    await openScenario(page, "E2E");
    await waitForScene(page);
    expect(await page.evaluate(() => window.__gnssStudioTest!.labelShown("G01"))).toBe(true);

    await treeRow(page, "*").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Properties", exact: true }).click();
    await page.getByRole("tab", { name: "2D Graphics - Global Attributes" }).click();
    await page.getByLabel("Show Labels").uncheck();
    await propertiesWindow(page, "E2E").getByRole("button", { name: "Apply", exact: true }).click();

    await expect.poll(() => page.evaluate(() => window.__gnssStudioTest!.labelShown("G01"))).toBe(false);
  });
});
