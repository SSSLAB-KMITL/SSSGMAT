// Globe Manager อยู่ใน bundle หลัก (ลงทะเบียนจาก App) ส่วน Cesium แยก chunk ไว้ให้หน้าต่าง 3D โหลดแบบ dynamic import
// ถ้า Globe Manager (หรือสถานะ ion ที่มันอ่าน) import "cesium" แบบ static Cesium จะถูกลากเข้า bundle หลัก: test นี้ทำให้ import นั้นล้มดัง ๆ

import { expect, test, vi } from "vitest";

vi.mock("cesium", () => {
  throw new Error("cesium must not be imported by the Globe Manager or by ionState");
});

test("importing the Globe Manager and the ion state does not load cesium", async () => {
  const manager = await import("../../src/windows/GlobeManager/GlobeManager");
  const state = await import("../../src/cesium/ionState");
  expect(typeof manager.GlobeManager).toBe("function");
  expect(typeof state.ionStatus).toBe("function");
});
