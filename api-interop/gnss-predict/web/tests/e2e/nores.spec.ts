// Review Focus 1: scenario ที่ยังไม่มีผลลัพธ์ ต้องไม่ล่ม: หน้าต่าง 3D และ 2D แสดงแถบ "ยังไม่มีผลลัพธ์", Object Browser และ Properties ใช้ได้

import { expect, openObjectProperties, openScenario, test, treeRow } from "./fixtures";

test("a scenario without results shows the banner in both windows and keeps the object tools working", async ({ page }) => {
  await openScenario(page, "E2E_NORES");

  // แถบแจ้งในหน้าต่าง 3D และ 2D (ข้อความตกลงไว้ตายตัว)
  await expect(page.getByText("ยังไม่มีผลลัพธ์ — กด Apply เพื่อคำนวณ")).toHaveCount(2);

  // Object Browser มี Facility THBK แม้ไม่มีผล
  await expect(treeRow(page, "*/Facility/THBK")).toBeVisible();

  // เปิด Properties ของ THBK ได้ และฟอร์มโหลดค่าเสร็จ
  await openObjectProperties(page, "*/Facility/THBK");
  await expect(page.getByRole("tab", { name: "Basic - Position" })).toBeVisible();
  await expect(page.getByLabel("Latitude")).toHaveValue("13.729779");
});
