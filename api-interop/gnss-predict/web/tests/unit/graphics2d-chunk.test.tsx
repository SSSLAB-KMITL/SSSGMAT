// หน้าต่าง 2D เมื่อโหลดส่วนแสดงผล (chunk ของ Cesium: import("./scene2d")) ไม่สำเร็จ ต้องเป็นข้อความของตัวเองที่บอกว่าเป็นส่วน 2D

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { msg } from "../../src/labels/messages.th";
import { useMessages } from "../../src/stores/messages";
import { Graphics2D } from "../../src/windows/Graphics2D/Graphics2D";
import { resetAll } from "./helpers/chrome";

vi.mock("../../src/windows/Graphics2D/scene2d", () => {
  throw new Error("Failed to fetch dynamically imported module: /assets/scene2d-abc.js");
});

beforeEach(() => {
  resetAll();
  vi.stubGlobal("WebGLRenderingContext", function WebGLRenderingContext() {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("a 2D chunk that cannot be loaded shows its own Thai message and logs it", async () => {
  render(<Graphics2D panelId="graphics2d" params={{ n: 1 }} />);
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe(msg("scene.chunkFailed", { window: "2D" }));
  const logged = useMessages.getState().items.at(-1);
  expect(logged?.code).toBe("SCENE_CHUNK");
  const [before] = msg("scene.chunkFailedLog", { window: "2D", message: "\u0000" }).split("\u0000");
  expect(logged?.text.startsWith(before)).toBe(true);
});
