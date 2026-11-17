// Review Focus 3: สองแท็บแก้ scenario เดียวกัน Apply ของแท็บที่ ETag เก่าต้องขึ้นกล่อง Reload/Cancel ไม่ทับค่าของอีกแท็บ และ Reload เห็นค่าล่าสุด
// ใช้สำเนาของ E2E_NORES ชื่อสุ่ม (สำเนาไม่มีผลลัพธ์ แก้ได้โดยไม่กระทบ spec อื่น)

import { expect, openObjectProperties, openScenario, postJson, propertiesWindow, test, WRITE_HEADERS } from "./fixtures";

test("Apply on a stale ETag shows Reload/Cancel and Reload shows the other writer's value", async ({ page, request }) => {
  const name = `conflict_${Date.now().toString(36)}`;
  const copy = await postJson(request, "/api/scenarios/E2E_NORES/copy", { new_name: name });
  expect(copy.ok()).toBe(true);

  await openScenario(page, name);
  await openObjectProperties(page, "*/Facility/THBK");
  await page.getByRole("tab", { name: "Constraints - Active" }).click();

  // มุมเงยต่ำสุด (Constraints - Active: Elevation Angle > Min): แก้ค้างในฟอร์มก่อน (ยังไม่ Apply) ฟอร์มที่แก้ค้างอยู่จึงเป็นฝ่ายที่ ETag เก่า
  // (ฟอร์มที่ยังสะอาดตามค่าใหม่ของอีกแท็บเงียบ ๆ ไม่ชน จึงไม่ใช่กรณีนี้)
  const elevation = page.getByLabel("Min", { exact: true });
  await expect(elevation).toHaveValue("10");
  await elevation.fill("15");

  // "อีกแท็บ" แก้คำอธิบายของ THBK ผ่าน API ด้วย ETag ปัจจุบัน
  const current = await request.get(`/api/scenarios/${name}`);
  const etag = current.headers().etag;
  const patch = await request.patch(`/api/scenarios/${name}/objects/Facility/THBK`, {
    data: { basic: { description: "edited from the other tab" } },
    headers: { ...WRITE_HEADERS, "If-Match": etag },
  });
  expect(patch.ok()).toBe(true);

  // Apply: จะได้ 412 ทันที หรือ SSE ของการแก้ของอีกแท็บมาถึงก่อนแล้วฟอร์มรู้ตัวว่าชน ทั้งสองทางต้องขึ้นกล่อง Reload/Cancel
  await propertiesWindow(page, "THBK").getByRole("button", { name: "Apply", exact: true }).click();

  // หน้าต่างลอยของ dockview ก็มี role="dialog": เลือกกล่องตามชื่อ
  const dialog = page.getByRole("dialog", { name: "scenario ถูกแก้จากที่อื่น" });
  await expect(dialog.getByRole("button", { name: "Reload" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  await dialog.getByRole("button", { name: "Reload" }).click();
  await expect(dialog).toBeHidden();

  // ค่าของอีกแท็บอยู่ครบ (ไม่ถูกทับ) และฟอร์มแสดงมัน
  await page.getByRole("tab", { name: "Basic - Description" }).click();
  await expect(page.getByLabel("Short Description")).toHaveValue("edited from the other tab");
  const saved = await (await request.get(`/api/scenarios/${name}/objects/Facility/THBK`)).json();
  expect(saved.basic.description).toBe("edited from the other tab");
  // Reload ทิ้งค่าที่แก้ค้างและ Apply ที่ชนไม่ได้ส่งอะไรไป: มุมเงยบน server ยังเป็นค่าเดิม
  expect(saved.constraints.elevation_angle_min_deg).toBe(10);
  await page.getByRole("tab", { name: "Constraints - Active" }).click();
  await expect(elevation).toHaveValue("10");
});
