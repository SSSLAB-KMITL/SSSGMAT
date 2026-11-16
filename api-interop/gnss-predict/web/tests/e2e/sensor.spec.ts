// Sensor และ Sensor View (sensor spec §5, §8): เมนู Satellite -> Sensor View, Properties เปลี่ยน Cone Half Angle, คลิกที่ดาวในหน้าต่าง 3D,
// ลบดาวแล้วหน้าต่างปิด และ scenario ที่ไม่มีผลลัพธ์
// spec นี้แก้ scenario E2E และ E2E_NORES (สร้าง ลบ sensor ลบดาว) แล้วคืนค่าเดิมทุก test (spec อื่นใช้ E2E ด้วย)
// ดาวใน E2E: G01 (วาดในภาพ) กับ G22 ที่ถูกตัวกรองดาวซ่อน (ไม่มีตำแหน่งในภาพ) จึงคลิกที่ G22 ในหน้าต่าง 3D ไม่ได้ ใช้ R05 เป็นดาวที่สอง

import type { Locator, Page } from "@playwright/test";
import { currentTimeField, ephemHash, expect, openObjectProperties, openScenario, parseUtcg, propertiesWindow, saveScenario, test, toolButton, treeRow, waitForScene } from "./fixtures";
import { msg } from "../../src/labels/messages.th";

/** ค่าคงที่ของ spec (global constraints): รัศมีโลกของ cesium/swath.ts */
const EARTH_RADIUS_KM = 6371.0088;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

type Vec3 = readonly [number, number, number];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): number => Math.sqrt(dot(a, a));
const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ---------- หน้าต่างและ locator ----------

/** แท็บของหน้าต่าง Sensor View ตามชื่อ ("Sensor View - Sensor1 (G01)") */
const windowTab = (page: Page, title: string) => page.locator(".dv-default-tab-content").filter({ hasText: title });
const sensorViewTabs = (page: Page) => page.locator(".dv-default-tab-content").filter({ hasText: /^Sensor View - / });
const threeDCanvas = (page: Page): Locator => page.getByTestId("g3d-view").locator("canvas").first();
const sensorViewCanvas = (page: Page): Locator => page.getByTestId("sensor-view").locator("canvas").first();

/** เลือกดาวใน Object Browser แล้วสั่งเมนู Satellite (เมนูบนที่ชื่อตาม object ที่เลือก) -> Sensor View */
async function openSensorViewFromSatelliteMenu(page: Page, satellite: string): Promise<void> {
  await treeRow(page, `*/Satellite/${satellite}`).click();
  await page.getByRole("menuitem", { name: "Satellite", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sensor View", exact: true }).click();
}

// ---------- test hook ----------

const sensorCamera = (page: Page, sensor: string) => page.evaluate((n) => window.__gnssStudioTest!.sensorViewCamera(n), sensor);
const entityPosition = (page: Page, name: string) => page.evaluate((n) => window.__gnssStudioTest!.entityPositionEcef(n), name);

interface Lock {
  /** ระยะ (เมตร) ระหว่างกล้องกับดาว */
  distanceM: number;
  /** มุม (องศา) ระหว่างทิศของกล้องกับทิศไปศูนย์กลางโลก (−ตำแหน่งดาว) */
  angleDeg: number;
}

/** กล้องของ Sensor View ณ ตอนนี้ เทียบกับตำแหน่งของดาวแม่ในหน้าต่าง 3D (อ่านสองค่าใน evaluate เดียว: เวลาเดียวกัน) ไม่มีกล้องหรือไม่มีดาว = null */
async function cameraLock(page: Page, sensor: string, satellite: string): Promise<Lock | null> {
  const [camera, position] = await page.evaluate(
    ([s, sat]) => [window.__gnssStudioTest!.sensorViewCamera(s), window.__gnssStudioTest!.entityPositionEcef(sat)] as const,
    [sensor, satellite] as const,
  );
  if (camera === null || position === null) return null;
  const toEarthCentre: Vec3 = [-position[0], -position[1], -position[2]];
  const cos = dot(camera.direction, toEarthCentre) / (norm(camera.direction) * norm(toEarthCentre));
  return { distanceM: norm(minus(camera.position, position)), angleDeg: Math.acos(Math.min(1, Math.max(-1, cos))) * DEG };
}

/** กล้องอยู่ที่ดาวไม่เกิน 1 ม. และมองศูนย์กลางโลกคลาดไม่เกิน 0.01° (เกณฑ์ข้อ 1 ของ spec) */
function expectLocked(lock: Lock | null, what: string): void {
  expect(lock, `${what}: Sensor View camera and satellite position`).not.toBeNull();
  expect(lock!.distanceM, `${what}: camera distance from the satellite (m)`).toBeLessThanOrEqual(1);
  expect(lock!.angleDeg, `${what}: angle between the view direction and the Earth centre (deg)`).toBeLessThanOrEqual(0.01);
}

/** รอจนกล้องของ Sensor View ตามดาว ณ เวลาปัจจุบัน (ไม่เกิน 1 ม.) แล้วคืนค่าที่วัดได้ */
async function waitForLock(page: Page, sensor: string, satellite: string): Promise<Lock> {
  await expect
    .poll(async () => (await cameraLock(page, sensor, satellite))?.distanceM ?? Number.POSITIVE_INFINITY, { message: `${sensor} camera follows ${satellite}` })
    .toBeLessThanOrEqual(1);
  return (await cameraLock(page, sensor, satellite))!;
}

/** ขนาดภาพของ Sensor View เป็นพิกเซล CSS: ค่าเดียวกับที่ Cesium ใช้หาสัดส่วนภาพ (clientWidth / clientHeight) */
const sensorViewSize = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="sensor-view"] canvas');
    return canvas === null ? null : { width: canvas.clientWidth, height: canvas.clientHeight };
  });

/** fov ด้านสั้นของภาพ (องศา): fovDeg ของ Cesium คือด้านยาว จึงลดตามสัดส่วนภาพ */
async function shortSideFovDeg(page: Page, sensor: string): Promise<number | null> {
  const [camera, size] = [await sensorCamera(page, sensor), await sensorViewSize(page)];
  if (camera === null || size === null || size.width === 0 || size.height === 0) return null;
  const ratio = Math.max(size.width / size.height, size.height / size.width);
  return 2 * Math.atan(Math.tan((camera.fovDeg * RAD) / 2) / ratio) * DEG;
}

/** จุด (พิกเซลของภาพ) ที่ตำแหน่ง ECEF `target` ปรากฏใน Sensor View ตามกล้องที่อ่านได้ ไม่อยู่ข้างหน้ากล้องหรือนอกภาพ = null */
function projectToView(
  camera: { position: Vec3; direction: Vec3; up: Vec3; fovDeg: number },
  size: { width: number; height: number },
  target: Vec3,
): { x: number; y: number } | null {
  const right = cross(camera.direction, camera.up);
  const v = minus(target, camera.position);
  const depth = dot(v, camera.direction);
  if (depth <= 0) return null;
  const aspect = size.width / size.height;
  // fov ของ Cesium คือด้านยาวของภาพ: tan(ครึ่งมุมแนวตั้ง) = tan(fov / 2) เมื่อภาพสูงกว่ากว้าง ไม่งั้นหารด้วยสัดส่วนภาพ
  const tanHalfVertical = Math.tan((camera.fovDeg * RAD) / 2) / Math.max(aspect, 1);
  const x = size.width / 2 + ((dot(v, right) / (depth * tanHalfVertical * aspect)) * size.width) / 2;
  const y = size.height / 2 - ((dot(v, camera.up) / (depth * tanHalfVertical)) * size.height) / 2;
  return x >= 0 && x <= size.width && y >= 0 && y <= size.height ? { x, y } : null;
}

// ---------- คลิกที่ดาวในหน้าต่าง 3D ----------

/**
 * กล้องตั้งต้นของหน้าต่าง 3D เห็นดาวไม่กี่ดวงที่ขอบภาพ (และหน้าต่างหดตัวเมื่อเปิด Sensor View): ซูมออกด้วยล้อเมาส์จนดาวทุกดวงอยู่ในภาพ
 * (ล้อเมาส์ธรรมดา = ซูม; Shift + ล้อ = Step Forward/Backward) แล้วรอจนภาพนิ่ง (settledPoint)
 */
async function zoomOut3D(page: Page): Promise<void> {
  const box = await threeDCanvas(page).boundingBox();
  expect(box, "3D canvas").not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  for (let i = 0; i < 2; i++) await page.mouse.wheel(0, 800);
}

/**
 * ตำแหน่ง [x, y] (พิกเซลของ canvas ซึ่ง locator.click ใช้เป็น position) ของดาวในหน้าต่าง 3D ตัวแรก หลังภาพนิ่ง
 * (ขนาดของ canvas และตำแหน่งไม่เปลี่ยนระหว่างสองรอบที่ถามติดกัน) และ scene ที่อ่านเป็นของหน้าต่างที่ workbook สร้าง
 * (sceneLoadedAt ≥ workbookRestoredAt แบบ waitForScene: ตำแหน่งจากหน้าต่างที่กำลังถูกแทนคลิกพลาด) ไม่แสดงอยู่ในภาพ = รอจนหมดเวลา
 */
async function settledPoint(page: Page, name: string): Promise<{ x: number; y: number }> {
  const canvas = threeDCanvas(page);
  let previous = "";
  let point: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        const box = await canvas.boundingBox();
        const { at, current } = await page.evaluate((n) => {
          const hooks = window.__gnssStudioTest!;
          const restored = hooks.workbookRestoredAt();
          const loaded = hooks.sceneLoadedAt();
          return { at: hooks.entityScreenPosition(n), current: restored !== null && loaded !== null && loaded >= restored };
        }, name);
        const key = JSON.stringify([box, at]);
        const settled = current && at !== null && box !== null && key === previous;
        previous = key;
        point = settled ? { x: at[0], y: at[1] } : null;
        return settled;
      },
      { message: `${name} on screen in the 3D window`, intervals: [250] },
    )
    .toBe(true);
  return point!;
}

// ---------- scenario ----------

/** ค่าใน scenario (เอกสารที่ server เก็บ) ของ sensor */
async function sensorOnServer(page: Page, scenario: string, name: string) {
  const reply = await page.request.get(`/api/scenarios/${scenario}`);
  expect(reply.ok()).toBe(true);
  const doc = (await reply.json()) as { objects: { class: string; name: string; parent?: string; definition?: { cone_half_angle: number } }[] };
  return doc.objects.find((o) => o.class === "Sensor" && o.name === name);
}

test.describe("Sensor and Sensor View", () => {
  // undefined = ยังไม่ได้เก็บเอกสารเดิม (beforeEach ล้มก่อน): ไม่มีอะไรให้คืน และต้องไม่เรียกค่าของ test ก่อนหน้า
  let restores: (() => Promise<void>)[] | undefined;
  let hashBefore = "";

  test.beforeEach(async ({ request }) => {
    restores = undefined;
    hashBefore = await ephemHash(request, "E2E");
    restores = [await saveScenario(request, "E2E"), await saveScenario(request, "E2E_NORES")];
  });
  test.afterEach(async ({ request }) => {
    const undo = restores;
    restores = undefined;
    if (undo === undefined) return;
    for (const restore of undo) await restore();
    // sensor และการลบดาวไม่แตะผลการคำนวณ: เมื่อคืนเอกสารเดิมแล้ว ephem ของ E2E ยังเป็นชุดเดิมและยังเป็นปัจจุบัน
    expect(await ephemHash(request, "E2E"), "ephem hash of E2E after restoring the scenario").toBe(hashBefore);
  });

  test("Sensor View from the satellite menu looks at the Earth centre", async ({ page }) => {
    await openScenario(page, "E2E");
    await waitForScene(page);
    await openSensorViewFromSatelliteMenu(page, "G01");
    await expect(windowTab(page, "Sensor View - Sensor1 (G01)")).toBeVisible();

    // กล้องอยู่ที่ดาวไม่เกิน 1 ม. และทิศชี้ศูนย์กลางโลกคลาดไม่เกิน 0.01° (boresight ตั้งต้น el 90° = −r̂)
    expectLocked(await waitForLock(page, "Sensor1", "G01"), "at the start time");

    // Cone Half Angle ตั้งต้น = มุมครึ่งหนึ่งของจานโลกที่ดาวเห็น + 0.5° ปัดทศนิยม 1 ตำแหน่ง (ที่ตำแหน่งของดาว ณ เวลาที่สร้าง)
    const position = (await entityPosition(page, "G01"))!;
    const disc = Math.asin(EARTH_RADIUS_KM / (norm(position) / 1000)) * DEG;
    const sensor = await sensorOnServer(page, "E2E", "Sensor1");
    expect(sensor?.parent).toBe("*/Satellite/G01");
    expect(Math.abs(sensor!.definition!.cone_half_angle - (disc + 0.5))).toBeLessThanOrEqual(0.0501);

    // fov ด้านสั้น = 2α × 1.05 (ไม่เกิน 120°)
    await expect
      .poll(() => shortSideFovDeg(page, "Sensor1"))
      .toBeCloseTo(Math.min(2 * sensor!.definition!.cone_half_angle * 1.05, 120), 2);
  });

  test("double-clicking in the Sensor View keeps the camera on the satellite", async ({ page }) => {
    await openScenario(page, "E2E");
    await waitForScene(page);
    await openSensorViewFromSatelliteMenu(page, "G01");
    await expect(windowTab(page, "Sensor View - Sensor1 (G01)")).toBeVisible();

    // 03:36 G01 อยู่เหนือ THBK (fixture: ผ่านเหนือ THBK ที่ 12960 s): THBK อยู่ในภาพของ Sensor View ให้ดับเบิลคลิกที่มันได้
    const OVER_THBK = "2026-11-10T03:36:00Z";
    await page.evaluate((t) => window.__gnssStudioTest!.setTime(t), OVER_THBK);
    expectLocked(await waitForLock(page, "Sensor1", "G01"), "at 03:36");

    const canvas = sensorViewCanvas(page);
    const size = (await sensorViewSize(page))!;
    const camera = (await sensorCamera(page, "Sensor1"))!;
    // THBK: lat 13.729779, lon 100.781151, alt 6.4 m (WGS 84) ตำแหน่ง ECEF ของ Facility ใช้จุดที่ 3D window วาด (entityPositionEcef)
    const facility = await entityPosition(page, "THBK");
    const points: [string, { x: number; y: number } | null][] = [
      ["the centre", { x: size.width / 2, y: size.height / 2 }],
      ["the Earth disc", { x: size.width / 2 + size.width / 5, y: size.height / 2 - size.height / 8 }],
      ["the Facility marker", facility === null ? null : projectToView(camera, size, facility)],
    ];
    expect(points[2][1], "THBK is inside the Sensor View at 03:36").not.toBeNull();

    for (const [what, position] of points) {
      await canvas.dblclick({ position: position! });
      // ทันทีหลังดับเบิลคลิก
      expectLocked(await cameraLock(page, "Sensor1", "G01"), `right after a double-click on ${what}`);
      // และหลังภาพวาดอีกสองเฟรม (การบินหรือการตามที่ค้างจะดึงกล้องออกในเฟรมถัดไป)
      await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      expectLocked(await cameraLock(page, "Sensor1", "G01"), `two frames after a double-click on ${what}`);
    }

    // เดินเวลา 1 step (60 วินาที): กล้องต้องตามดาวไปที่ตำแหน่งใหม่ ไม่ค้างอยู่ที่เดิมหรือหลุดไปตามสิ่งที่ดับเบิลคลิก
    const before = parseUtcg(await currentTimeField(page).inputValue());
    const moved = (await entityPosition(page, "G01"))!;
    await toolButton(page, "Step Forward").click();
    await expect.poll(async () => parseUtcg(await currentTimeField(page).inputValue()) - before).toBe(60_000);
    const after = await waitForLock(page, "Sensor1", "G01");
    expectLocked(after, "after Step Forward");
    expect(norm(minus((await entityPosition(page, "G01"))!, moved)), "G01 moved during the step (m)").toBeGreaterThan(1000);
  });

  test("changing Cone Half Angle changes the view and the footprint", async ({ page, request }) => {
    await openScenario(page, "E2E");
    await waitForScene(page);
    await openSensorViewFromSatelliteMenu(page, "G01");
    await expect(windowTab(page, "Sensor View - Sensor1 (G01)")).toBeVisible();
    await waitForLock(page, "Sensor1", "G01");
    // กรวยตั้งต้นกว้างกว่าจานโลก: fov ด้านสั้นกว้างกว่าค่าใหม่มาก
    expect(await shortSideFovDeg(page, "Sensor1")).toBeGreaterThan(20);

    await openObjectProperties(page, "*/Sensor/Sensor1");
    const properties = propertiesWindow(page, "Sensor1");
    await properties.getByLabel("Cone Half Angle").fill("5");
    await properties.getByRole("button", { name: "Apply", exact: true }).click();

    // fov ด้านสั้น = 2 × 5° × 1.05 = 10.5° (คำนวณจากขนาดภาพ: fovDeg ของ Cesium คือด้านยาว)
    // อ่านเมื่อขนาดภาพและ fov นิ่งแล้ว (สองครั้งติดกันได้ค่าเดียวกัน): ระหว่างที่หน้าต่างยังจัดขนาด ขนาดกับกล้องมาจากคนละเฟรมได้
    let previous: string | null = null;
    await expect
      .poll(async () => {
        const size = await sensorViewSize(page);
        const fov = await shortSideFovDeg(page, "Sensor1");
        const now = JSON.stringify([size, fov]);
        const stable = now === previous;
        previous = now;
        return stable && fov !== null ? fov : Number.NaN;
      }, { intervals: [100, 200, 400] })
      .toBeCloseTo(10.5, 2);
    // รอยบนพื้นโลกยังวาดทั้งในหน้าต่าง 3D และ 2D
    await expect.poll(() => page.evaluate(() => window.__gnssStudioTest!.sensorFootprint("Sensor1", "3d"))).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => window.__gnssStudioTest!.sensorFootprint("Sensor1", "2d"))).toBeGreaterThan(0);
    expect((await sensorOnServer(page, "E2E", "Sensor1"))?.definition?.cone_half_angle).toBe(5);
    // เพิ่มและแก้ sensor ไม่ทำให้ผลการคำนวณเป็นของเก่า (เกณฑ์ข้อ 4)
    expect(await ephemHash(request, "E2E")).toBe(hashBefore);
  });

  test("left-click on a satellite in 3D selects it in the Object Browser", async ({ page }) => {
    await openScenario(page, "E2E");
    await waitForScene(page);
    await zoomOut3D(page);
    await treeRow(page, "*/Facility/THBK").click();
    await expect(treeRow(page, "*/Facility/THBK")).toHaveAttribute("aria-selected", "true");

    const at = await settledPoint(page, "G01");
    await threeDCanvas(page).click({ position: at });
    await expect(treeRow(page, "*/Satellite/G01")).toHaveAttribute("aria-selected", "true");
    await expect(treeRow(page, "*/Facility/THBK")).toHaveAttribute("aria-selected", "false");
  });

  test("right-click on a satellite in 3D opens Sensor View", async ({ page }) => {
    await openScenario(page, "E2E");
    await waitForScene(page);
    // หน้าต่างแรก: จากเมนู Satellite ของ G01
    await openSensorViewFromSatelliteMenu(page, "G01");
    await expect(windowTab(page, "Sensor View - Sensor1 (G01)")).toBeVisible();
    await expect(sensorViewTabs(page)).toHaveCount(1);

    // หน้าต่างที่สอง: คลิกขวาที่ R05 ในหน้าต่าง 3D (หน้าต่างแรกทำให้หน้าต่าง 3D หดตัว จึงซูมออกและรอให้ภาพนิ่งก่อน)
    await zoomOut3D(page);
    const at = await settledPoint(page, "R05");
    await threeDCanvas(page).click({ position: at, button: "right" });
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveCount(3);
    for (const name of ["Properties", "Sensor View", "Zoom To"]) await expect(menu.getByRole("menuitem", { name, exact: true })).toBeVisible();
    // คลิกขวาเลือกดาวใต้เมาส์ด้วย
    await expect(treeRow(page, "*/Satellite/R05")).toHaveAttribute("aria-selected", "true");

    await menu.getByRole("menuitem", { name: "Sensor View", exact: true }).click();
    await expect(windowTab(page, "Sensor View - Sensor2 (R05)")).toBeVisible();
    await expect(sensorViewTabs(page)).toHaveCount(2);
    expect((await sensorOnServer(page, "E2E", "Sensor2"))?.parent).toBe("*/Satellite/R05");
  });

  test("deleting the satellite closes its Sensor View", async ({ page }) => {
    await openScenario(page, "E2E");
    await waitForScene(page);
    await openSensorViewFromSatelliteMenu(page, "G01");
    await expect(windowTab(page, "Sensor View - Sensor1 (G01)")).toBeVisible();
    await waitForLock(page, "Sensor1", "G01");
    await expect(treeRow(page, "*/Sensor/Sensor1")).toBeVisible();

    await treeRow(page, "*/Satellite/G01").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    // ลบดาวลบ sensor ของดาวด้วย: กล่องยืนยันต้องบอกจำนวนก่อน
    await expect(page.getByRole("dialog")).toContainText("Sensor ของดาวนี้ 1 ตัวจะถูกลบไปด้วย");
    await page.getByRole("dialog").getByRole("button", { name: "OK", exact: true }).click();

    await expect(treeRow(page, "*/Satellite/G01")).toHaveCount(0);
    await expect(treeRow(page, "*/Sensor/Sensor1")).toHaveCount(0);
    await expect(sensorViewTabs(page)).toHaveCount(0);
    expect(await sensorCamera(page, "Sensor1")).toBeNull();
    expect(await sensorOnServer(page, "E2E", "Sensor1")).toBeUndefined();
  });

  test("Sensor View without results shows the Thai message", async ({ page }) => {
    await openScenario(page, "E2E_NORES");
    await openSensorViewFromSatelliteMenu(page, "G01");
    await expect(windowTab(page, "Sensor View - Sensor1 (G01)")).toBeVisible();

    await expect(page.getByText(msg("sensorView.noPosition", { satellite: "G01" }))).toBeVisible();
    expect(await sensorCamera(page, "Sensor1")).toBeNull();
    // ดาวยังไม่มีตำแหน่ง: Cone Half Angle ตั้งต้น 45°
    expect((await sensorOnServer(page, "E2E_NORES", "Sensor1"))?.definition?.cone_half_angle).toBe(45);
  });
});
