// ดาวถ่ายภาพ (ข2 spec §1 เกณฑ์ข้อ 1, 4, 5 และ §6 e2e): Insert Terra จาก Satellite Catalog พร้อมกล้องหลัก, ดาว X04 กับรอย Rectangular ของ MODIS
// ในหน้าต่าง 3D/2D และ Show Imagery ที่ต้องถามก่อนออกเน็ต
// - server ของ e2e ไม่มี GMAT: scenario E2E_IMG (THBK + X04 + Sensor MODIS แบบ Rectangular 55.0/0.41) มีผล propagate และ analyze ของ THBK
//   จาก build_fixture.py (วงโคจรปลอม รัศมี 7076 km เอียง 98.2°: Ruling t) ส่วน Insert ทดสอบบน E2E_NORES (ไม่มีผล)
// - snapshot ของ e2e มีไฟล์กลุ่ม weather/science/visual จาก tests/fixtures/studio/imaging (เขียนเอง ไม่ใช่ข้อมูลที่ดาวน์โหลด)
// - ไม่มี request ใดออกนอก 127.0.0.1: ตัวกันของ fixtures.ts ทำงานทุก test และทุก test ตรวจเพิ่มว่า browser ไม่ส่งอะไรถึง /api/imagery/tiles ของ server
//   (สวิตช์ภาพออนไลน์ทุกแหล่งปิดใน settings.json ของ e2e) test ที่ไม่มี sensor ให้หน้าเว็บเห็น GIBS เป็น "เปิด" ด้วย page.route ของ /api/imagery/layers
//   (route.fetch() ขอของจริงจาก server ของ e2e ในเครื่อง แล้วแก้ sources.gibs ในคำตอบ) และตอบชิ้นภาพ /api/imagery/tiles เองในเบราว์เซอร์
//   (ชิ้นภาพไม่ถึง server จึงไม่มีอะไรไป GIBS: และ server ที่สวิตช์ปิดตอบ 403 โดยไม่ต่อเน็ตอยู่แล้ว)
// - spec นี้แก้ E2E_NORES (Insert) และ E2E_IMG (ลบ sensor) แล้วคืนเอกสารเดิมทุก test

import type { APIRequestContext, Page, Request } from "@playwright/test";
import { expect, openObjectProperties, openScenario, propertiesWindow, saveScenario, test, treeRow, waitForScene, WRITE_HEADERS } from "./fixtures";
import { msg } from "../../src/labels/messages.th";

const SCENARIO = "E2E_IMG";
const TERRA = { prn: "X04", norad: 25994 };
const SENSOR = "MODIS";
const TERRA_LAYER = "MODIS_Terra_CorrectedReflectance_TrueColor";
/** รัศมีโลกเฉลี่ย (km) เดียวกับ cesium/swath.ts */
const EARTH_RADIUS_KM = 6371.0088;
/** ความสูงต่ำสุดของกล้องที่ Show Imagery บินไปเหนือดาวที่ไม่มี sensor (FLY_OVER_MIN_KM ของ showImagery.ts) */
const FLY_OVER_MIN_KM = 3000;
/** จุดของวงรอย Rectangular: 4 ด้าน × 18 จุด + จุดปิดวง (rectangleRays perSide = 18) */
const RECTANGLE_RING_POINTS = 73;
/** PNG 1×1 โปร่งใส: ชิ้นภาพที่ test ตอบแทน server */
const BLANK_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const sensorViewTabs = (page: Page) => page.locator(".dv-default-tab-content").filter({ hasText: /^Sensor View - / });
const confirmDialog = (page: Page) => page.getByRole("dialog", { name: "Confirm", exact: true });
const hooks = {
  position: (page: Page, name: string) => page.evaluate((n) => window.__gnssStudioTest!.entityPositionEcef(n), name),
  footprint: (page: Page, name: string, view: "3d" | "2d") => page.evaluate(([n, v]) => window.__gnssStudioTest!.sensorFootprint(n, v), [name, view] as const),
  camera: (page: Page) => page.evaluate(() => window.__gnssStudioTest!.cameraPosition()),
  frames: (page: Page) => page.evaluate(() => window.__gnssStudioTest!.frameCount()),
};
const norm = (v: readonly number[]): number => Math.hypot(v[0], v[1], v[2]);

/** request ของ browser ที่ spec นี้นับ: แก้ค่าตั้ง (PUT /api/settings), สร้าง object (POST .../objects) และชิ้นภาพของ server */
interface Seen {
  settingsPuts: string[];
  objectPosts: string[];
  tiles: string[];
}

function watch(page: Page): Seen {
  const seen: Seen = { settingsPuts: [], objectPosts: [], tiles: [] };
  page.on("request", (r: Request) => {
    const path = new URL(r.url()).pathname;
    if (r.method() === "PUT" && path === "/api/settings") seen.settingsPuts.push(path);
    if (r.method() === "POST" && /^\/api\/scenarios\/[^/]+\/objects$/.test(path)) seen.objectPosts.push(path);
    if (path.startsWith("/api/imagery/tiles/")) seen.tiles.push(path);
  });
  return seen;
}

/** เอกสาร scenario ที่ server เก็บ */
async function scenarioDoc(page: Page, name: string) {
  const reply = await page.request.get(`/api/scenarios/${name}`);
  expect(reply.ok()).toBe(true);
  return (await reply.json()) as { objects: { class: string; name: string; parent?: string; definition?: Record<string, unknown> }[] };
}

/** สวิตช์ภาพออนไลน์ของ server (GET /api/settings ผ่าน page.request: ไม่นับเป็น request ของ browser) */
async function onlineImagery(page: Page): Promise<Record<string, boolean>> {
  const reply = await page.request.get("/api/settings");
  expect(reply.ok()).toBe(true);
  return ((await reply.json()) as { online_imagery: Record<string, boolean> }).online_imagery;
}

/** ปิด Satellite Models ที่ 3D Graphics Window Properties หน้า Details (ค่าตั้งของหน้าต่างในหน้าเว็บ ไม่บันทึกลงไฟล์: เหมือน models.spec.ts) */
async function satelliteModelsOff(page: Page): Promise<void> {
  const toolbar = page.getByRole("toolbar", { name: "3D Window Defaults" });
  if (!(await toolbar.isVisible())) {
    await page.getByRole("menuitem", { name: "View", exact: true }).click();
    await page.getByRole("menuitem", { name: "Toolbars", exact: true }).click();
    await page.getByRole("menuitemcheckbox", { name: "3D Window Defaults", exact: true }).click();
  }
  await toolbar.getByRole("button", { name: "Properties", exact: true }).click();
  const props = page.locator(".props").filter({ has: page.getByRole("tab", { name: "Details", exact: true }) });
  await props.getByRole("tab", { name: "Details", exact: true }).click();
  await props.getByLabel("Satellite Models", { exact: true }).uncheck();
  await props.getByRole("button", { name: "OK", exact: true }).click();
  await expect(props).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__gnssStudioTest!.modelCount()), { message: "no satellite models" }).toBe(0);
}

/** คลิกขวาที่ดาวใน Object Browser แล้วเลือก Show Imagery (ต้องใช้ได้: ดาวมี preset) */
async function showImageryFromTree(page: Page, satellite: string): Promise<void> {
  await treeRow(page, `*/Satellite/${satellite}`).click({ button: "right" });
  const item = page.getByRole("menu").getByRole("menuitem", { name: "Show Imagery", exact: true });
  await expect(item).toBeVisible();
  await expect(item).not.toHaveAttribute("aria-disabled", "true");
  await item.click();
}

test.describe("Imaging satellites", () => {
  // undefined = ยังไม่ได้เก็บเอกสารเดิม (beforeEach ล้มก่อน): ไม่มีอะไรให้คืน
  let restores: (() => Promise<void>)[] | undefined;
  let seen: Seen;

  test.beforeEach(async ({ page, request }) => {
    restores = undefined;
    restores = [await saveScenario(request, "E2E_NORES"), await saveScenario(request, SCENARIO)];
    seen = watch(page);
  });
  test.afterEach(async () => {
    const undo = restores;
    restores = undefined;
    if (undo !== undefined) for (const restore of undo) await restore();
  });

  test("insert Terra with its primary sensor", async ({ page }) => {
    await openScenario(page, "E2E_NORES");
    await expect(treeRow(page, `*/Satellite/${TERRA.prn}`)).toHaveCount(0);

    await page.getByRole("menuitem", { name: "Insert", exact: true }).click();
    await page.getByRole("menuitem", { name: "New...", exact: true }).click();
    await page.getByRole("radio", { name: "Satellite", exact: true }).check();
    await page.getByRole("radio", { name: "From Satellite Catalog" }).check();
    await page.getByRole("button", { name: "Insert...", exact: true }).click();

    // System = Imaging: เหลือเฉพาะดาวระบบ X (PRN X0n) แล้วเลือก X04
    const grid = page.getByRole("grid", { name: "Search Satellite Catalog" });
    await expect(grid).toBeVisible();
    await page.getByLabel("System", { exact: true }).selectOption({ label: "Imaging" });
    const rows = grid.locator("tbody tr");
    await expect(rows.first()).toBeVisible();
    for (const prn of await rows.locator("td:first-child").allInnerTexts()) expect(prn).toMatch(/^X0[1-8]$/);
    await grid.getByRole("row", { name: new RegExp(`^${TERRA.prn} `) }).click();
    await expect(page.getByText(msg("catalog.selected", { n: 1 }))).toBeVisible();
    // Add Primary Sensor ติ๊กไว้เป็นค่าตั้งต้น (Ruling m)
    await expect(page.getByRole("checkbox", { name: "Add Primary Sensor", exact: true })).toBeChecked();
    const posted = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/scenarios/E2E_NORES/objects");
    await page.getByRole("button", { name: "Insert", exact: true }).click();
    expect((await posted).postDataJSON()).toMatchObject({ norads: [TERRA.norad], primary_sensors: true });

    // ต้นไม้: X04 และ Sensor MODIS เป็นลูกของมัน (ลึกกว่าหนึ่งชั้น)
    const satellite = treeRow(page, `*/Satellite/${TERRA.prn}`);
    const sensor = treeRow(page, `*/Sensor/${SENSOR}`);
    await expect(satellite).toBeVisible();
    await expect(sensor).toBeVisible();
    const level = Number(await satellite.getAttribute("aria-level"));
    await expect(sensor).toHaveAttribute("aria-level", String(level + 1));

    // server เก็บ Sensor ตาม preset: Rectangular, Vertical 55.0 (ขวางแนวบิน) / Horizontal 0.41 ไม่มี cone_half_angle (Ruling g, v)
    const stored = (await scenarioDoc(page, "E2E_NORES")).objects.find((o) => o.class === "Sensor" && o.name === SENSOR);
    expect(stored?.parent).toBe(`*/Satellite/${TERRA.prn}`);
    expect(stored?.definition).toEqual({ type: "Rectangular", vertical_half_angle: 55.0, horizontal_half_angle: 0.41 });

    // หน้า Basic - Definition ของ Properties
    await openObjectProperties(page, `*/Sensor/${SENSOR}`);
    const properties = propertiesWindow(page, SENSOR);
    await properties.getByRole("tab", { name: "Basic - Definition", exact: true }).click();
    await expect(properties.getByLabel("Sensor Type", { exact: true })).toHaveValue("Rectangular");
    await expect(properties.getByLabel("Vertical Half Angle", { exact: true })).toHaveValue("55");
    await expect(properties.getByLabel("Horizontal Half Angle", { exact: true })).toHaveValue("0.41");
    await expect(properties.getByLabel("Cone Half Angle", { exact: true })).toHaveCount(0);

    expect(seen.tiles, "browser requests to /api/imagery/tiles").toEqual([]);
  });

  test("imaging satellite in 3D", async ({ page }) => {
    await openScenario(page, SCENARIO);
    await waitForScene(page);

    // X04 มีตำแหน่งในหน้าต่าง 3D ที่ความสูงของวงโคจรปลอม (7076 − 6371 ≈ 705 km)
    await expect.poll(() => hooks.position(page, TERRA.prn), { message: `${TERRA.prn} position in 3D` }).not.toBeNull();
    const altitudeKm = norm((await hooks.position(page, TERRA.prn))!) / 1000 - EARTH_RADIUS_KM;
    expect(altitudeKm, `${TERRA.prn} altitude (km)`).toBeGreaterThanOrEqual(690);
    expect(altitudeKm, `${TERRA.prn} altitude (km)`).toBeLessThanOrEqual(720);

    // รอยของ MODIS เป็นวงสี่เหลี่ยม (4 ด้าน × 18 จุด + จุดปิดวง) ทั้งในหน้าต่าง 3D และ 2D
    await expect.poll(() => hooks.footprint(page, SENSOR, "3d"), { message: "MODIS footprint in 3D" }).toBe(RECTANGLE_RING_POINTS);
    await expect.poll(() => hooks.footprint(page, SENSOR, "2d"), { message: "MODIS footprint in 2D" }).toBe(RECTANGLE_RING_POINTS);

    expect(seen.tiles, "browser requests to /api/imagery/tiles").toEqual([]);
  });

  test("Show Imagery asks before going online", async ({ page }) => {
    await openScenario(page, SCENARIO);
    await waitForScene(page);
    expect((await onlineImagery(page)).enabled, "GIBS switch in the e2e data").toBe(false);

    await showImageryFromTree(page, TERRA.prn);
    // กล่องยืนยันเดียวกับสวิตช์ GIBS ของ Globe Manager (Ruling f) -> Cancel
    const dialog = confirmDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(msg("globe.consent"));
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();

    // ไม่ทำอะไรเลย: ไม่มี Sensor View, ค่าตั้งเดิม, ไม่มี PUT /api/settings และไม่มีชิ้นภาพ
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    await expect(sensorViewTabs(page)).toHaveCount(0);
    expect((await onlineImagery(page)).enabled, "GIBS switch after Cancel").toBe(false);
    expect(seen.settingsPuts, "PUT /api/settings after Cancel").toEqual([]);
    expect(seen.objectPosts, "POST .../objects after Cancel").toEqual([]);
    expect(seen.tiles, "browser requests to /api/imagery/tiles").toEqual([]);
  });

  /** Show Imagery ของ X04 ที่ไม่มี Sensor (amendment z) ; satelliteModels = false ปิด Satellite Models ก่อน, true เปิดไว้เพื่อตรวจตัวกันของเว็บกับ terra.glb ที่ยังเสีย (ดู test ข้างล่าง) */
  async function showImageryWithoutSensor(page: Page, request: APIRequestContext, satelliteModels: boolean): Promise<void> {
    // ลบ MODIS ออกจาก E2E_IMG (afterEach คืนเอกสารเดิม) sensor ไม่อยู่ในข้อมูลตั้งต้นของ ephem จึงยังมีผลลัพธ์อยู่
    const reply = await request.get(`/api/scenarios/${SCENARIO}`);
    const doc = await reply.json();
    doc.objects = doc.objects.filter((o: { class: string }) => o.class !== "Sensor");
    const put = await request.put(`/api/scenarios/${SCENARIO}`, { data: doc, headers: { ...WRITE_HEADERS, "If-Match": reply.headers().etag } });
    expect(put.ok(), "removing MODIS").toBe(true);

    // หน้าเว็บเห็น GIBS เป็นเปิด (ค่าตั้งบน server ยังปิด) และชิ้นภาพตอบในเบราว์เซอร์ ไม่ถึง server
    const answered: string[] = [];
    await page.route("**/api/imagery/layers", async (route) => {
      const real = await route.fetch();
      const body = await real.json();
      await route.fulfill({ response: real, json: { ...body, enabled: true, sources: { ...body.sources, gibs: true } } });
    });
    await page.route("**/api/imagery/tiles/**", async (route) => {
      answered.push(new URL(route.request().url()).pathname);
      await route.fulfill({ status: 200, contentType: "image/png", body: BLANK_PNG });
    });

    await openScenario(page, SCENARIO);
    await waitForScene(page);
    await expect(treeRow(page, `*/Sensor/${SENSOR}`)).toHaveCount(0);
    if (!satelliteModels) await satelliteModelsOff(page);
    const satellite = (await hooks.position(page, TERRA.prn))!;
    expect(satellite).not.toBeNull();

    await showImageryFromTree(page, TERRA.prn);
    // GIBS "เปิดอยู่": ไม่ถาม
    await expect(confirmDialog(page)).toHaveCount(0);

    // กล้องของหน้าต่าง 3D บินไปเหนือจุดใต้ดาว ที่ความสูง max(ความสูงของดาว, 3000 km) (amendment z)
    const expectedRadiusKm = EARTH_RADIUS_KM + FLY_OVER_MIN_KM;
    await expect
      .poll(async () => {
        const camera = await hooks.camera(page);
        if (camera === null) return Number.POSITIVE_INFINITY;
        const cos = (camera[0] * satellite[0] + camera[1] * satellite[1] + camera[2] * satellite[2]) / (norm(camera) * norm(satellite));
        const angleDeg = (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
        return Math.max(angleDeg, Math.abs(norm(camera) / 1000 - expectedRadiusKm) / 100);
      }, { message: "3D camera above the sub-satellite point of X04", timeout: 15_000 })
      .toBeLessThanOrEqual(0.5);
    // หน้าต่าง 3D ยังวาดต่อหลังบิน (render loop ไม่หยุด)
    const frames = await hooks.frames(page);
    await page.evaluate((t) => window.__gnssStudioTest!.setTime(t), "2026-11-10T00:01:00Z");
    await expect.poll(() => hooks.frames(page), { message: "3D frames after the flight" }).toBeGreaterThan(frames);
    // ชั้นของ Terra ถูกเปิด: เบราว์เซอร์ขอชิ้นภาพของชั้นนั้น (ตอบโดย route ข้างบน)
    await expect.poll(() => answered.some((p) => p.startsWith(`/api/imagery/tiles/${TERRA_LAYER}/`)), { message: `${TERRA_LAYER} tiles requested` }).toBe(true);

    // ไม่สร้าง object ใด ไม่เปิด Sensor View และไม่แก้ค่าตั้ง
    expect(seen.objectPosts, "POST .../objects").toEqual([]);
    await expect(sensorViewTabs(page)).toHaveCount(0);
    expect((await scenarioDoc(page, SCENARIO)).objects.filter((o) => o.class === "Sensor")).toEqual([]);
    expect(seen.settingsPuts, "PUT /api/settings").toEqual([]);
    expect((await onlineImagery(page)).enabled, "GIBS switch on the server").toBe(false);
    // ทุกชิ้นภาพที่หน้าเว็บขอถูกตอบในเบราว์เซอร์ (ไม่มีชิ้นใดถึง server): request event มาก่อน handler ของ route จึงรอจนนับตรงกัน
    await expect
      .poll(() => ({ unanswered: seen.tiles.length - answered.length, unknown: seen.tiles.filter((t) => !answered.includes(t)) }), {
        message: "every tile the browser asked for was answered by the route",
      })
      .toEqual({ unanswered: 0, unknown: [] });
  }

  test("Show Imagery on a satellite without a sensor creates nothing and flies over it", async ({ page, request }) => {
    // Satellite Models ปิด: test นี้ตรวจคำสั่ง Show Imagery อย่างเดียว จึงใช้จุดของดาวแทนโมเดล
    // (Terra เป็นโมเดลกับ terra.glb ที่ยังเสีย = test ถัดไป: ตัวกันปิดโมเดลของหน้าต่างแล้ววาดต่อ)
    await showImageryWithoutSensor(page, request, false);
  });

  // ตัวกันในเว็บ (ข2 final C1): models/terra/terra.glb ยังมีข้อบกพร่อง (mesh wing-Y ใช้วัสดุมีภาพ 10/11 แต่ไม่มี TEXCOORD_0 shader ของ Cesium
  // คอมไพล์ไม่ผ่าน 'v_texCoord_0') เมื่อ Terra เป็นโมเดลในภาพ renderError ครั้งแรก = หน้าต่างนั้นปิดโมเดลของตัวเอง ดาวเป็นจุด แล้ววาดต่อ
  // test นี้จึงใช้ glb ที่เสียจริงเป็นตัวพิสูจน์ (แก้ glb แล้ว ข้อความ SCENE_MODELS_DISABLED จะไม่เกิด: ให้ปรับ test นี้ตามนั้น)
  test("Show Imagery on Terra with Satellite Models on", async ({ page, request }) => {
    // บินไปและวาดต่อหลังบิน (ตรวจใน helper) ทั้งที่ Satellite Models ของหน้าต่างเปิดอยู่
    await showImageryWithoutSensor(page, request, true);
    // โมเดลของหน้าต่างนี้ปิดในหน่วยความจำ: ไม่มีโมเดล X04 เป็นจุด
    await expect.poll(() => page.evaluate(() => window.__gnssStudioTest!.modelCount()), { message: "satellite models in the 3D window" }).toBe(0);
    expect(await page.evaluate((n) => window.__gnssStudioTest!.pointShown(n), TERRA.prn), `${TERRA.prn} drawn as a point`).toBe(true);
    // Message Viewer: SCENE_MODELS_DISABLED หนึ่งข้อความ ไม่มี SCENE_RENDER และไม่มีข้อความ "หยุดทำงาน" แทนภาพ
    await page.getByRole("tab", { name: "Message Viewer" }).click();
    const disabled = page.getByRole("row").filter({ hasText: "SCENE_MODELS_DISABLED" });
    await expect(disabled).toHaveCount(1);
    await expect(disabled).toContainText("v_texCoord_0");
    await expect(page.getByRole("row").filter({ hasText: "SCENE_RENDER" })).toHaveCount(0);
    await expect(page.getByRole("alert").filter({ hasText: msg("scene.renderStopped") })).toHaveCount(0);
    // ยังวาดอยู่หลังปิดโมเดล: เวลาเปลี่ยนแล้วมีเฟรมใหม่ และไม่มีข้อความเพิ่ม
    const frames = await hooks.frames(page);
    await page.evaluate((t) => window.__gnssStudioTest!.setTime(t), "2026-11-10T00:02:00Z");
    await expect.poll(() => hooks.frames(page), { message: "3D frames with the models off" }).toBeGreaterThan(frames);
    await expect(disabled).toHaveCount(1);
  });
});
