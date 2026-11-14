// โมเดล 3 มิติของดาวในหน้าต่าง 3D (models integration spec §5): e2e ไม่ต่อเน็ตเลย
// - ไฟล์โมเดลมากับแอป: dist/models/catalog.json และ dist/models/<id>/<ไฟล์>.glb (server ส่งเป็นไฟล์ static ของเว็บ) หน้าเว็บ fetch แต่ละไฟล์ครั้งเดียวแล้วให้ Cesium โหลดจาก
//   blob: URL ของ origin เดียวกัน (satModels.loadModelGlb) ตัวกัน request นอกเครื่องของ fixtures.ts อนุญาต blob: และ data: อยู่แล้ว จึงไม่แก้
//   spec นี้นับ request ของ browser ที่ไป /models/catalog.json (ต้องครั้งเดียว) และ /models/<...>.glb (ไม่เกินครั้งเดียวต่อไฟล์) ตลอดทุก test
// - data ของ e2e มีดาวชุดเล็ก (snapshot ทดสอบ) บางดวงถูกตัวกรองดาวซ่อน: "ดาวที่แสดง" = ดาวใน scenario ที่ป้ายชื่อแสดงอยู่ในหน้าต่าง 3D ตัวแรก (labelShown)
//   modelCount() ต้องเท่าจำนวนนั้นพอดี (ดาวทุกดวงได้โมเดล: ตาม block, norad_ids หรือ generic) และจุดของดาวเหล่านั้นซ่อน
// - ปิด Satellite Models ที่ 3D Graphics Window Properties (หน้า Details) -> modelCount() = 0 และจุดแสดง เปิดอีกครั้ง -> โมเดลกลับมาโดยไม่ fetch ไฟล์ใหม่
// - ท่าทาง (ไม่ใช้ภาพจับหน้าจอ): satelliteOrientation(ชื่อดาว) ให้แกนตัวดาวใน ECEF +Z ต้องชี้ศูนย์กลางโลกคลาดไม่เกิน 0.5° และตามเวลาเมื่อ setTime
// - spec นี้ไม่แก้ scenario ใด (ปิดเปิด Satellite Models เป็นค่าตั้งของหน้าต่างในหน้าเว็บ ไม่ถูกบันทึกลงไฟล์)

import type { Page } from "@playwright/test";
import { E2E_ORIGIN } from "./localRequest";
import { expect, openScenario, test as base, waitForScene } from "./fixtures";

const DEG = 180 / Math.PI;
/** ครบเวลาที่รอโมเดล: glb 23 ไฟล์ รวมราว 14 MB และ render ด้วย SwiftShader (CPU) */
const MODELS_TIMEOUT_MS = 30_000;

type Vec3 = readonly [number, number, number];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): number => Math.sqrt(dot(a, a));
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** มุม (องศา) ระหว่างสองเวกเตอร์ */
const angleDeg = (a: Vec3, b: Vec3): number => Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (norm(a) * norm(b))))) * DEG;

/** request ของ browser (ทุกหน้า) ที่ไฟล์โมเดลของแอป: path ของ catalog และ path ของ glb ทุกครั้งที่ขอ (รวมครั้งที่ซ้ำ) */
interface ModelRequests {
  catalog: string[];
  glb: string[];
}

const test = base.extend<{ modelRequests: ModelRequests }>({
  modelRequests: [
    async ({ context }, use) => {
      const seen: ModelRequests = { catalog: [], glb: [] };
      context.on("request", (r) => {
        const url = new URL(r.url());
        if (url.protocol !== "http:" || url.origin !== E2E_ORIGIN) return; // blob: ของ Cesium ไม่นับ (ไม่ใช่ไฟล์ของ server)
        if (url.pathname === "/models/catalog.json") seen.catalog.push(url.pathname);
        else if (url.pathname.startsWith("/models/") && url.pathname.endsWith(".glb")) seen.glb.push(url.pathname);
      });
      await use(seen);
    },
    { auto: true },
  ],
});

/** ชื่อดาวทั้งหมดใน scenario (ตามที่ server เก็บ) */
async function satelliteNames(page: Page, scenario: string): Promise<string[]> {
  const reply = await page.request.get(`/api/scenarios/${scenario}`);
  expect(reply.ok()).toBe(true);
  const doc = (await reply.json()) as { objects: { class: string; name: string }[] };
  return doc.objects.filter((o) => o.class === "Satellite").map((o) => o.name);
}

const shownSatellites = (page: Page, names: string[]): Promise<string[]> =>
  page.evaluate((all) => all.filter((n) => window.__gnssStudioTest!.labelShown(n) === true), names);

const modelCount = (page: Page): Promise<number> => page.evaluate(() => window.__gnssStudioTest!.modelCount());

/**
 * รอจนดาวที่แสดงทุกดวงเป็นโมเดลแล้วคืนรายชื่อ (ต้องมีอย่างน้อยหนึ่งดวง) รอรวมกันเพราะ sceneLoadedAt มาก่อน manifest (NORAD -> PRN) ได้:
 * ก่อนนั้น labelShown ของดาวทุกดวงเป็น null (ไม่รู้ว่า entity ไหน) จึงอ่านรายชื่อซ้ำจนกว่าจะนิ่ง
 */
async function waitForModels(page: Page, names: string[]): Promise<string[]> {
  await waitForScene(page);
  let shown: string[] = [];
  await expect
    .poll(
      async () => {
        shown = await shownSatellites(page, names);
        return shown.length > 0 && (await modelCount(page)) === shown.length;
      },
      { message: "every shown satellite drawn as a model", timeout: MODELS_TIMEOUT_MS },
    )
    .toBe(true);
  return shown;
}

/** จุดของดาวในรายชื่อแสดงอยู่กี่ดวง */
const pointsShown = (page: Page, names: string[]): Promise<number> =>
  page.evaluate((all) => all.filter((n) => window.__gnssStudioTest!.pointShown(n) === true).length, names);

/** เปิด 3D Graphics Window Properties จากปุ่ม Properties ของแถบ 3D Window Defaults (ซ่อนอยู่ตั้งต้น: เปิดจาก View -> Toolbars) แล้วไปหน้า Details */
async function openDetails(page: Page) {
  await page.getByRole("menuitem", { name: "View", exact: true }).click();
  await page.getByRole("menuitem", { name: "Toolbars", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "3D Window Defaults", exact: true }).click();
  await page.getByRole("toolbar", { name: "3D Window Defaults" }).getByRole("button", { name: "Properties", exact: true }).click();
  const props = page.locator(".props").filter({ has: page.getByRole("tab", { name: "Details", exact: true }) });
  await expect(props).toBeVisible();
  await props.getByRole("tab", { name: "Details", exact: true }).click();
  return props;
}

test("the 3D window draws every shown satellite as a model, hides their points, and fetches each model file once", async ({ page, modelRequests }) => {
  await openScenario(page, "E2E");
  const names = await satelliteNames(page, "E2E");
  const shown = await waitForModels(page, names);
  expect(shown.length, "the fixture has hidden satellites too (satellite filter), so shown < all").toBeLessThan(names.length);

  // model หรือจุด อย่างใดอย่างหนึ่ง: ดาวที่แสดงไม่มีจุดซ้อน
  expect(await pointsShown(page, shown)).toBe(0);
  // ดาวที่ถูกซ่อนไม่ถูกนับ
  expect(await modelCount(page)).toBe(shown.length);

  expect(modelRequests.catalog, "GET /models/catalog.json").toEqual(["/models/catalog.json"]);
  expect(modelRequests.glb.length, "model files fetched").toBeGreaterThan(0);
  expect(new Set(modelRequests.glb).size, `no model file fetched twice: ${modelRequests.glb.join(", ")}`).toBe(modelRequests.glb.length);

  // ไฟล์ที่ขอทุกไฟล์อยู่ใน catalog (server ไม่ส่งอะไรนอก catalog และหน้าเว็บไม่ขอ path อื่น)
  const reply = await page.request.get("/models/catalog.json");
  expect(reply.ok()).toBe(true);
  const catalog = (await reply.json()) as { models: { id: string; glb: string }[] };
  const inCatalog = new Set(catalog.models.map((m) => `/models/${m.glb}`));
  for (const path of modelRequests.glb) expect(inCatalog.has(path), `${path} is listed in the catalog`).toBe(true);
});

test("Satellite Models off in 3D Graphics Window Properties: no models and every shown satellite is a point again; on again: models back without new fetches", async ({
  page,
  modelRequests,
}) => {
  await openScenario(page, "E2E");
  const names = await satelliteNames(page, "E2E");
  const shown = await waitForModels(page, names);
  const fetched = [...modelRequests.glb];

  const props = await openDetails(page);
  const check = props.getByLabel("Satellite Models", { exact: true });
  await expect(check).toBeChecked();
  await check.uncheck();
  await props.getByRole("button", { name: "Apply", exact: true }).click();

  await expect.poll(() => modelCount(page), { message: "Satellite Models off", timeout: MODELS_TIMEOUT_MS }).toBe(0);
  expect(await pointsShown(page, shown), "points of the shown satellites").toBe(shown.length);
  // ชื่อ (ป้าย) ยังอยู่เหมือนเดิม
  expect(await shownSatellites(page, names)).toEqual(shown);

  await check.check();
  await props.getByRole("button", { name: "OK", exact: true }).click();
  await expect.poll(() => modelCount(page), { message: "Satellite Models on again", timeout: MODELS_TIMEOUT_MS }).toBe(shown.length);
  expect(await pointsShown(page, shown)).toBe(0);

  // ปิดแล้วเปิดใหม่ไม่ fetch ไฟล์ใดซ้ำและไม่ขอ catalog อีก
  expect(modelRequests.catalog).toEqual(["/models/catalog.json"]);
  expect(modelRequests.glb).toEqual(fetched);
});

test("model attitude: body +Z of each shown satellite points to Earth (within 0.5 degrees), the axes are orthonormal, and it follows the animation time", async ({ page }) => {
  await openScenario(page, "E2E");
  const names = await satelliteNames(page, "E2E");
  const shown = await waitForModels(page, names);

  interface Pose {
    name: string;
    pos: [number, number, number] | null;
    axes: { x: [number, number, number]; y: [number, number, number]; z: [number, number, number] } | null;
  }
  /** ตำแหน่งและแกนของดาวแต่ละดวง ณ เวลาเดียวกัน (ใน evaluate เดียว) */
  const poses = (): Promise<Pose[]> =>
    page.evaluate((all) => all.map((name) => ({ name, pos: window.__gnssStudioTest!.entityPositionEcef(name), axes: window.__gnssStudioTest!.satelliteOrientation(name) })), shown);
  /** คลาดจากทิศลงโลกของ +Z ของดาวแต่ละดวง (องศา) ดวงที่ยังไม่มีท่าทาง = Infinity */
  const nadirErrors = async (): Promise<number[]> =>
    (await poses()).map((p) => (p.pos === null || p.axes === null ? Infinity : angleDeg(p.axes.z, [-p.pos[0], -p.pos[1], -p.pos[2]])));

  // เวลาในช่วงตัวอย่างตำแหน่ง ห่างจากขอบ (ท่าทางใช้ตำแหน่ง t ± 1 s จึงต้องมีตัวอย่างทั้งสองด้านของ t)
  await page.evaluate(() => window.__gnssStudioTest!.setTime("2026-11-10T01:00:00Z"));
  await expect.poll(async () => Math.max(...(await nadirErrors())), { message: "body +Z within 0.5° of nadir for every shown satellite", timeout: MODELS_TIMEOUT_MS }).toBeLessThan(0.5);

  for (const p of await poses()) {
    const a = p.axes!;
    for (const v of [a.x, a.y, a.z]) expect(norm(v), `${p.name} axis length`).toBeCloseTo(1, 6);
    expect(Math.abs(dot(a.x, a.y)), `${p.name} x.y`).toBeLessThan(1e-6);
    expect(Math.abs(dot(a.y, a.z)), `${p.name} y.z`).toBeLessThan(1e-6);
    expect(Math.abs(dot(a.z, a.x)), `${p.name} z.x`).toBeLessThan(1e-6);
    expect(angleDeg(cross(a.x, a.y), a.z), `${p.name} right-handed`).toBeLessThan(1e-4);
  }

  // เวลาเปลี่ยนสามชั่วโมง (ดาวเคลื่อนไปหลายสิบองศา): +Z ยังชี้ลงโลกหลังรอบ throttle 250 ms
  const before = await poses();
  await page.evaluate(() => window.__gnssStudioTest!.setTime("2026-11-10T04:00:00Z"));
  await expect.poll(async () => Math.max(...(await nadirErrors())), { message: "body +Z within 0.5° of nadir after setTime", timeout: MODELS_TIMEOUT_MS }).toBeLessThan(0.5);
  const after = await poses();
  // ดาวแต่ละดวงหมุนตามการเคลื่อนที่ของตัวเอง (ดาว GEO ของ BeiDou อยู่นิ่งใน ECEF จึงไม่หมุน): มุมที่ +Z หมุนไปเท่ามุมที่ตำแหน่งหมุนไป
  let moved = 0;
  for (const [i, p] of after.entries()) {
    const turnedAxis = angleDeg(p.axes!.z, before[i].axes!.z);
    const turnedPosition = angleDeg(p.pos!, before[i].pos!);
    expect(Math.abs(turnedAxis - turnedPosition), `${p.name} +Z turned ${turnedAxis.toFixed(2)}° but its position ${turnedPosition.toFixed(2)}°`).toBeLessThan(1);
    if (turnedAxis > 5) moved++;
  }
  expect(moved, "satellites whose attitude moved with the time").toBeGreaterThan(0);
});
