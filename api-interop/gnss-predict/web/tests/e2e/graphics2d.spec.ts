// หน้าต่าง 2D และภาพที่หยุด (follow-up 13b-2 ของ QA batch)
// - คลิกซ้ายบนแผนที่ 2D: คลิกของ Viewer ของ Cesium (pickImageryLayerFeatures) เคยโยน DeveloperError "Ray intersections are only supported in 3D mode"
//   ทุกครั้ง (pageerror) ตอนนี้ถอดออกแล้ว หน้าต่าง 2D เลือกดาวเองด้วย pick.ts แบบหน้าต่าง 3D (fixture ล้ม test เมื่อมี pageerror)
// - render loop ของ Cesium ที่หยุดเงียบ ๆ (ข้อผิดพลาดนอก Scene.render) ถูกเริ่มใหม่หนึ่งครั้ง ภาพวาดต่อ และ Message Viewer มีข้อความเดียวต่อหน้าต่าง
//   test hook breakRenderLoop ทำให้เฟรมถัดไปโยนข้อผิดพลาดใน clock.tick (นอก Scene.render) หนึ่งครั้ง

import type { Page } from "@playwright/test";
import { msg } from "../../src/labels/messages.th";
import { expect, openScenario, test, treeRow, waitForScene } from "./fixtures";

const twoDCanvas = (page: Page) => page.getByTestId("g2d-view").locator("canvas").first();

/** ตำแหน่งของ object ในหน้าต่าง 2D หลังภาพนิ่ง (สองรอบที่ถามติดกันเท่ากัน) */
async function settled2D(page: Page, name: string): Promise<{ x: number; y: number }> {
  let previous = "";
  let point: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        const at = await page.evaluate((n) => window.__gnssStudioTest!.entityScreenPosition2d(n), name);
        const key = JSON.stringify(at);
        const settled = at !== null && key === previous;
        previous = key;
        point = settled ? { x: at[0], y: at[1] } : null;
        return settled;
      },
      { message: `${name} on the 2D map`, intervals: [250] },
    )
    .toBe(true);
  return point!;
}

/** นับ draw call ของ WebGL บน canvas ของหน้าต่าง (ตัวฟังติดที่ context ตัวเดิมของ Cesium) */
async function countDraws(page: Page, testId: string): Promise<void> {
  await page.evaluate((id) => {
    const canvas = document.querySelector<HTMLCanvasElement>(`[data-testid="${id}"] canvas`);
    const gl = (canvas?.getContext("webgl2") ?? canvas?.getContext("webgl")) as unknown as Record<string, (...a: unknown[]) => unknown> | null;
    if (gl === null || gl === undefined) throw new Error(`no WebGL context in ${id}`);
    const w = window as unknown as { __draws: Record<string, number> };
    w.__draws ??= {};
    w.__draws[id] = 0;
    for (const name of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"]) {
      const original = gl[name];
      if (typeof original !== "function") continue;
      gl[name] = function (this: unknown, ...args: unknown[]) {
        w.__draws[id]++;
        return original.apply(this, args);
      };
    }
  }, testId);
}
const draws = (page: Page, testId: string) => page.evaluate((id) => (window as unknown as { __draws: Record<string, number> }).__draws[id], testId);

const sceneRenderRows = (page: Page) => page.getByRole("row").filter({ hasText: "SCENE_RENDER" });

test("left-clicking the 2D map raises no page error, and a click on a satellite in 2D selects it", async ({ page }) => {
  await openScenario(page, "E2E");
  await waitForScene(page);
  await treeRow(page, "*/Facility/THBK").click();
  await expect(treeRow(page, "*/Facility/THBK")).toHaveAttribute("aria-selected", "true");

  // คลิกที่ว่างบนแผนที่ (มุมบนซ้าย ขั้วโลกเหนือ ไม่มีดาว): ไม่มี pageerror และการเลือกเดิมอยู่
  await twoDCanvas(page).click({ position: { x: 6, y: 6 } });
  await twoDCanvas(page).dblclick({ position: { x: 6, y: 6 } });
  await expect(treeRow(page, "*/Facility/THBK")).toHaveAttribute("aria-selected", "true");

  // คลิกที่ดาว G01 บนแผนที่ 2D = เลือก G01 ใน Object Browser
  const at = await settled2D(page, "G01");
  await twoDCanvas(page).click({ position: at });
  await expect(treeRow(page, "*/Satellite/G01")).toHaveAttribute("aria-selected", "true");
  await expect(treeRow(page, "*/Facility/THBK")).toHaveAttribute("aria-selected", "false");
});

test("a render loop that stops is restarted once: the 2D and 3D pictures draw again and each window logs one message", async ({ page }) => {
  await openScenario(page, "E2E");
  await waitForScene(page);
  await page.getByRole("tab", { name: "Message Viewer" }).click();
  await expect(sceneRenderRows(page)).toHaveCount(0);
  const fromTime = Date.UTC(2026, 10, 10, 1, 0, 0);

  for (const [view, testId, n] of [["2d", "g2d-view", 1], ["3d", "g3d-view", 2]] as const) {
    await countDraws(page, testId);
    expect(await page.evaluate((v) => window.__gnssStudioTest!.breakRenderLoop(v), view)).toBe(true);
    // ตรวจทุก 1 วินาที: เจอแล้วเริ่มใหม่ และแจ้งหนึ่งข้อความ
    await expect(sceneRenderRows(page)).toHaveCount(n, { timeout: 5_000 });
    await expect(sceneRenderRows(page).nth(n - 1)).toContainText(msg("scene.renderRestartedLog", { window: view.toUpperCase(), message: "render loop stopped" }));
    // loop วิ่งอยู่จริง: เปลี่ยนเวลาแล้วภาพวาดใหม่ (loop ที่ตายแล้วไม่วาดอะไรเลย)
    const before = await draws(page, testId);
    await page.evaluate((ms) => window.__gnssStudioTest!.setTime(new Date(ms).toISOString()), fromTime + n * 600_000);
    await expect.poll(() => draws(page, testId), { message: `${view} draws after the restart` }).toBeGreaterThan(before);
    // ไม่ใช่ข้อความ "หยุดทำงาน" แทนภาพ
    await expect(page.getByRole("alert").filter({ hasText: msg("scene.renderStopped") })).toHaveCount(0);
  }
  // ไม่มีข้อความเพิ่มภายหลัง (ตัวตรวจทุก 1 วินาทีผ่านไปอย่างน้อยสองรอบตามนาฬิกาของหน้า แล้วไม่เจอว่าหยุดอีก)
  const mark = await page.evaluate(() => performance.now());
  await expect
    .poll(async () => {
      const elapsed = await page.evaluate((m) => performance.now() - m, mark);
      return elapsed >= 2_500 ? sceneRenderRows(page).count() : null;
    }, { message: "SCENE_RENDER rows 2.5 s after both restarts", intervals: [250] })
    .toBe(2);
});
