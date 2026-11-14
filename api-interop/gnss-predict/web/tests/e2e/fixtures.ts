// ตัวช่วยร่วมของ e2e: test ที่ฟัง pageerror และ request ออกนอกเครื่องทุกหน้า (ถ้ามี = fail), เปิด scenario ด้วย ?test, อ่าน/แก้ผ่าน API ด้วย Origin ของ server
// ไม่เรียก /api/orbits/fetch, /api/daily/run หรือ /validate (ผู้ใช้ห้ามดาวน์โหลดจาก CelesTrak/CDDIS/MGEX): ทุกการเรียกในนี้อ่านหรือแก้ data fixture ในเครื่อง

import { expect, test as base, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import { allowedOrigins, E2E_ORIGIN, isLocalRequest } from "./localRequest";

export const ORIGIN = E2E_ORIGIN;
/** server ตอบ 403 FORBIDDEN_ORIGIN กับคำขอที่แก้ข้อมูลซึ่ง Origin ไม่ตรง origin ของตัวเอง */
export const WRITE_HEADERS = { Origin: ORIGIN };

// window.__gnssStudioTest ประกาศไว้ใน src/cesium/testHooks.ts (tsconfig รวม src กับ tests)

/** origin ที่หน้าเว็บขอได้: server ของ e2e เอง และ origin ของ GNSS_E2E_PERF_URL ตรงตัวเมื่อตั้งไว้ (perf.spec.ts วัดบน server ที่ port 8767) ดู localRequest.ts */
const LOCAL_ORIGINS = allowedOrigins(process.env.GNSS_E2E_PERF_URL);

/**
 * ทุก spec ใช้ test ตัวนี้ ตรวจตอนจบ test (ทั้งสองข้อล้มแล้ว test fail):
 * - pageerror ที่เกิดระหว่าง test = fail
 * - request ของ browser context (ทุกหน้า รวม frame, worker, ภาพ, font, script) ที่ไม่ใช่ `http://127.0.0.1:8766/...`, `data:` หรือ `blob:` = fail พร้อมรายการ URL
 *   (ตั้ง GNSS_E2E_PERF_URL = เพิ่มอีกหนึ่ง origin คือของ URL นั้นตรงตัว)
 */
export const test = base.extend<{ pageErrors: string[]; requestGuard: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(`${e.name}: ${e.message}`));
      await use(errors);
      expect(errors, "uncaught errors in the page").toEqual([]);
    },
    { auto: true },
  ],
  requestGuard: [
    async ({ context }, use) => {
      const outside: string[] = [];
      context.on("request", (r) => {
        if (!isLocalRequest(r.url(), LOCAL_ORIGINS)) outside.push(`${r.method()} ${r.url()}`);
      });
      await use(outside);
      expect(outside, `requests that left the local server (only ${LOCAL_ORIGINS.join(", ")}, data: and blob: are allowed)`).toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export async function openScenario(page: Page, name: string): Promise<void> {
  await page.goto(`/?sc=${encodeURIComponent(name)}&test`);
  // ต้นไม้ของ Object Browser ขึ้น = scenario เปิดแล้ว
  await expect(page.getByRole("treeitem").first()).toBeVisible();
}

/** รอจน scene ของหน้าต่าง 3D โหลดผลลัพธ์เสร็จ (sceneLoadedAt มีค่า: scene.czml ถูกใช้และ manifest มาแล้ว ดาวหาได้ตามชื่อ เช่น labelShown("G01")) */
export async function waitForScene(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__gnssStudioTest?.sceneLoadedAt() ?? null), { message: "3D scene loaded" }).not.toBeNull();
}

// แถวของ Object Browser ตาม path (ราก = "*", Satellite G01 = "*" + "/Satellite/G01"); ต้นไม้เป็น virtual list: แถวนอกจอไม่อยู่ใน DOM
export const treeRow = (page: Page, path: string) => page.locator(`[role="treeitem"][data-row-key="${path}"]`);

export async function openObjectProperties(page: Page, path: string): Promise<void> {
  await treeRow(page, path).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Properties", exact: true }).click();
}

/** หน้าต่าง Properties ของ object (ชื่อ "<ชื่อ> Properties"): ปุ่ม Apply ก็มีบนแถบแจ้งของหน้าต่าง 3D/2D ด้วย จึงต้องจำกัดในหน้าต่างนี้ */
export const propertiesWindow = (page: Page, title: string) => page.getByRole("tabpanel", { name: `${title} Properties` });

export async function postJson(request: APIRequestContext, url: string, data: unknown): Promise<APIResponse> {
  return request.post(url, { data, headers: WRITE_HEADERS });
}

export interface Results {
  ephem: { hash: string | null; status: string; available: string[] };
}

export async function ephemHash(request: APIRequestContext, scenario: string): Promise<string> {
  const reply = await request.get(`/api/scenarios/${scenario}/results`);
  expect(reply.ok()).toBe(true);
  const results = (await reply.json()) as Results;
  expect(results.ephem.status).toBe("current");
  return results.ephem.hash as string;
}

/** แปลงเวลาที่แสดง (UTCG: `10 Nov 2026 01:02:30.000 UTCG`) เป็น epoch ms */
export function parseUtcg(text: string): number {
  const m = /^(\d{1,2}) (\w{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2})\.(\d{3}) UTCG$/.exec(text.trim());
  if (m === null) throw new Error(`not a UTCG time: ${JSON.stringify(text)}`);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return Date.UTC(Number(m[3]), months.indexOf(m[2]), Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]), Number(m[7]));
}

/** เวลา animation ที่แสดงในแถบสถานะ (ช่อง Animation Time) */
export const animationTime = (page: Page) => page.locator('[data-field="animationTime"]');
export const currentTimeField = (page: Page) => page.getByRole("textbox", { name: "Current Scenario Time" });
export const toolButton = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** scenario ที่แก้ได้โดยไม่ทิ้งรอย: เก็บเอกสารเดิม แล้วคืนให้ (PUT ทั้งก้อนด้วย ETag ล่าสุด) */
export async function saveScenario(request: APIRequestContext, name: string): Promise<() => Promise<void>> {
  const reply = await request.get(`/api/scenarios/${name}`);
  expect(reply.ok()).toBe(true);
  const original = await reply.json();
  return async () => {
    const latest = await request.get(`/api/scenarios/${name}`);
    const put = await request.put(`/api/scenarios/${name}`, { data: original, headers: { ...WRITE_HEADERS, "If-Match": latest.headers().etag } });
    expect(put.ok(), `restoring ${name}`).toBe(true);
  };
}
