// หน้าต่าง 3D เมื่อโหลดส่วนแสดงผล (chunk ของ Cesium: import("./scene3d")) ไม่สำเร็จ เช่น server ถูกอัปเดตระหว่างที่หน้าเปิดอยู่
// ต้องเป็นข้อความของตัวเอง ไม่ใช่ "ไม่รองรับ WebGL" หรือ "โหลดผลลัพธ์ไม่สำเร็จ"

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { msg } from "../../src/labels/messages.th";
import { useMessages } from "../../src/stores/messages";
import { Graphics3D } from "../../src/windows/Graphics3D/Graphics3D";
import { resetAll } from "./helpers/chrome";

vi.mock("../../src/windows/Graphics3D/scene3d", () => {
  throw new Error("Failed to fetch dynamically imported module: /assets/scene3d-abc.js");
});

beforeEach(() => {
  resetAll();
  vi.stubGlobal("WebGLRenderingContext", function WebGLRenderingContext() {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("a 3D chunk that cannot be loaded shows its own Thai message and logs it", async () => {
  render(<Graphics3D panelId="graphics3d" params={{ n: 1 }} />);
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe(msg("g3d.chunkFailed"));
  expect(alert.textContent).not.toBe(msg("webgl.unsupported"));
  // Message Viewer: ข้อความของตัวเองพร้อมรายละเอียดของ browser (vitest ห่อ error ของ factory ด้วยข้อความของมันเอง จึงตรวจแค่ส่วนต้น)
  const logged = useMessages.getState().items.at(-1);
  expect(logged?.code).toBe("SCENE_CHUNK");
  const [before] = msg("g3d.chunkFailedLog", { message: "\u0000" }).split("\u0000");
  expect(logged?.text.startsWith(before)).toBe(true);
});
