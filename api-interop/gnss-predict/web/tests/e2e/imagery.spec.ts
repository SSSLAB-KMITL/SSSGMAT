// โหมด Camera ของ Sensor View และ Globe Manager (imagery spec §5.1, §5.3, §7 และ spec ภาพละเอียด §4.3, §4.4): e2e ไม่ต่อเน็ตเลย
// - server ของ e2e ตั้ง online_imagery ทั้งสี่ช่อง (enabled = GIBS, eox, osm, ion) เป็น false และ cesium_ion_token ว่าง (build_fixture.py)
//   จึงไม่มี request ไป /api/imagery/tiles จากหน้าเว็บ และ server ไม่ส่งอะไรไป GIBS หรือ EOX ; osm กับ ion ปิด = browser ไม่ต่อ tile.openstreetmap.org / api.cesium.com
//   spec นี้ไม่เปิดแหล่งใด ไม่ยืนยันกล่องใด และไม่ใส่ token ใด ๆ (ไม่ว่าจริงหรือปลอม)
//   ทุก test ตรวจตอนจบ (fixture `guards` ข้างล่าง) ว่าไม่มี request ของ browser ไปที่ /api/imagery/tiles และไม่มี request ไป origin ที่ไม่ใช่ server ของ e2e เลย
//   (ตัวกัน request นอกเครื่องของ fixtures.ts ทำงานซ้อนอีกชั้นกับทุก spec)
// - spec นี้เปิด Sensor View (สร้าง sensor ใน scenario E2E) แล้วคืนเอกสารเดิมทุก test เหมือน sensor.spec.ts (spec อื่นใช้ E2E ด้วย)
//   ไม่เรียก tile ของ server เอง (ไม่มี request ไปที่ /api/imagery/tiles ทั้งจากหน้าเว็บและจาก test)

import type { Page } from "@playwright/test";
import { ephemHash, expect, openScenario, saveScenario, test as base, treeRow, waitForScene } from "./fixtures";
import { E2E_ORIGIN, isLocalRequest } from "./localRequest";
import { msg } from "../../src/labels/messages.th";

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** request ของ browser (ทุกหน้า) ที่ไปที่ชิ้นภาพของ server: ต้องว่างเสมอ (สวิตช์ภาพออนไลน์ปิดทุกแหล่ง) */
const TILES_PATH = "/api/imagery/tiles";

const test = base.extend<{ guards: { tiles: string[]; outside: string[] } }>({
  guards: [
    async ({ context }, use) => {
      const tiles: string[] = [];
      const outside: string[] = [];
      context.on("request", (r) => {
        const url = r.url();
        if (new URL(url).pathname.startsWith(TILES_PATH)) tiles.push(`${r.method()} ${url}`);
        if (!isLocalRequest(url, [`${E2E_ORIGIN}/`])) outside.push(`${r.method()} ${url}`);
      });
      await use({ tiles, outside });
      expect.soft(tiles, `browser requests to ${TILES_PATH} (every online imagery switch is off in the e2e data)`).toEqual([]);
      expect(outside, "browser requests to any host other than the local e2e server (OSM, Cesium ion, GIBS and EOX included)").toEqual([]);
    },
    { auto: true },
  ],
});

// ---------- Sensor View ----------

const SATELLITE = "G01";
const SENSOR = "Sensor1";
const SENSOR_TAB = "Sensor View - Sensor1 (G01)";

const windowTab = (page: Page, title: string) => page.locator(".dv-default-tab-content").filter({ hasText: title });
const sensorView = (page: Page) => page.locator(".sensor-view");
const zoomIn = (page: Page) => sensorView(page).getByRole("button", { name: "Zoom In", exact: true });
const zoomOut = (page: Page) => sensorView(page).getByRole("button", { name: "Zoom Out", exact: true });
const displayButton = (page: Page, name: "Camera" | "Sensor") =>
  sensorView(page).getByRole("group", { name: "Display", exact: true }).getByRole("button", { name, exact: true });
const zoomValue = (page: Page) => sensorView(page).locator(".sensor-view-zoom-value");
const hud = (page: Page) => page.getByTestId("sensor-view-hud");

/** เลือกดาวใน Object Browser แล้วสั่งเมนู Satellite -> Sensor View (เหมือน sensor.spec.ts) */
async function openSensorView(page: Page): Promise<void> {
  await treeRow(page, `*/Satellite/${SATELLITE}`).click();
  await page.getByRole("menuitem", { name: "Satellite", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sensor View", exact: true }).click();
  await expect(windowTab(page, SENSOR_TAB)).toBeVisible();
}

const sensorCamera = (page: Page) => page.evaluate((n) => window.__gnssStudioTest!.sensorViewCamera(n), SENSOR);
/** ป้ายของ object ในหน้าต่าง 3D หลักแสดงอยู่จริงไหม (entity.isShowing รวม show ของ data source และของป้าย) */
const mainLabelShown = (page: Page, name: string) => page.evaluate((n) => window.__gnssStudioTest!.labelShown(n), name);

/** ระยะ (เมตร) ระหว่างกล้องของ Sensor View กับดาวแม่ในหน้าต่าง 3D (อ่านสองค่าใน evaluate เดียว: เวลาเดียวกัน) ไม่มีกล้องหรือไม่มีดาว = null */
async function cameraDistanceM(page: Page): Promise<number | null> {
  const [camera, position] = await page.evaluate(
    ([s, sat]) => [window.__gnssStudioTest!.sensorViewCamera(s), window.__gnssStudioTest!.entityPositionEcef(sat)] as const,
    [SENSOR, SATELLITE] as const,
  );
  if (camera === null || position === null) return null;
  const d = [camera.position[0] - position[0], camera.position[1] - position[1], camera.position[2] - position[2]];
  return Math.hypot(d[0], d[1], d[2]);
}

/** รอจนกล้องตามดาว (ไม่เกิน 1 ม.) แล้วคืนระยะที่วัดได้: scene พร้อม และมีตำแหน่งของดาวแล้ว */
async function waitForCameraOnSatellite(page: Page, what: string): Promise<void> {
  await expect
    .poll(async () => (await cameraDistanceM(page)) ?? Number.POSITIVE_INFINITY, { message: `${what}: Sensor View camera follows ${SATELLITE}` })
    .toBeLessThanOrEqual(1);
}

/** fov ด้านสั้นของภาพ (องศา): fovDeg ของ Cesium คือด้านยาว จึงลดตามสัดส่วนภาพ (เหมือน sensor.spec.ts) ไม่มีภาพหรือไม่มีกล้อง = null */
async function shortSideFovDeg(page: Page): Promise<number | null> {
  const camera = await sensorCamera(page);
  const size = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="sensor-view"] canvas');
    return canvas === null ? null : { width: canvas.clientWidth, height: canvas.clientHeight };
  });
  if (camera === null || size === null || size.width === 0 || size.height === 0) return null;
  const ratio = Math.max(size.width / size.height, size.height / size.width);
  return 2 * Math.atan(Math.tan((camera.fovDeg * RAD) / 2) / ratio) * DEG;
}

/** รัศมีโลกเฉลี่ย (กม.) ที่ HUD และสูตรของแอปใช้ (README 9.9) */
const EARTH_RADIUS_KM = 6371.0088;

/**
 * ความกว้างพื้นที่ (km) ที่จุดใต้ดาวตามด้านสั้น ประมาณจากความสูงของกล้องเหนือทรงกลมกับ fov ด้านสั้น: 2·h·tan(fov / 2)
 * ไม่ใช้สูตรของแอป (ส่วนโค้ง 2·Re·θ) เพื่อให้เป็นการวัดอิสระ: ที่ fov ≤ 2° สองสูตรต่างกันไม่ถึง 1%
 */
function expectedGroundWidthKm(cameraEcefM: readonly number[], shortFovDeg: number): number {
  const heightKm = Math.hypot(cameraEcefM[0], cameraEcefM[1], cameraEcefM[2]) / 1000 - EARTH_RADIUS_KM;
  return 2 * heightKm * Math.tan((shortFovDeg * RAD) / 2);
}

/** ความกว้างพื้นที่ที่ HUD แสดง (km: หน่วย m หารด้วย 1000) ไม่มีบรรทัดนี้ = null */
async function groundWidthKm(page: Page): Promise<number | null> {
  const text = await hud(page).innerText();
  for (const [key, scale] of [["sensorView.hudGroundWidthKm", 1], ["sensorView.hudGroundWidthM", 0.001]] as const) {
    const [before, after] = msg(key, { width: "\u0000" }).split("\u0000");
    const start = text.indexOf(before);
    if (start < 0) continue;
    const rest = text.slice(start + before.length);
    const end = after === "" ? rest.length : rest.indexOf(after);
    const value = Number(rest.slice(0, end < 0 ? rest.length : end).trim());
    if (Number.isFinite(value) && value > 0) return value * scale;
  }
  return null;
}

/** รอจน fov ด้านสั้นเท่า `expected` คลาดไม่เกิน 1% (เทียบเป็นสัดส่วน) */
async function expectShortSideFov(page: Page, expected: number, what: string): Promise<void> {
  await expect
    .poll(async () => {
      const fov = await shortSideFovDeg(page);
      return fov === null ? Number.POSITIVE_INFINITY : Math.abs(fov - expected) / expected;
    }, { message: `${what}: short-side fov (expected ${expected.toFixed(4)} deg)` })
    .toBeLessThanOrEqual(0.01);
}

test.describe("Sensor View Camera mode", () => {
  // undefined = ยังไม่ได้เก็บเอกสารเดิม (beforeEach ล้มก่อน): ไม่มีอะไรให้คืน
  let restore: (() => Promise<void>) | undefined;
  let hashBefore = "";

  test.beforeEach(async ({ request }) => {
    restore = undefined;
    hashBefore = await ephemHash(request, "E2E");
    restore = await saveScenario(request, "E2E");
  });
  test.afterEach(async ({ request }) => {
    const undo = restore;
    restore = undefined;
    if (undo === undefined) return;
    await undo();
    expect(await ephemHash(request, "E2E"), "ephem hash of E2E after restoring the scenario").toBe(hashBefore);
  });

  test("opens in Camera mode with nothing but the Earth, and zoom narrows the view while the camera stays on the satellite", async ({ page }) => {
    await openScenario(page, "E2E");
    await waitForScene(page);
    await openSensorView(page);
    await waitForCameraOnSatellite(page, "at ×1");

    // ค่าตั้งต้น: Camera, ×1, ไม่มี entity แสดงในภาพเลย
    await expect(displayButton(page, "Camera")).toHaveAttribute("aria-pressed", "true");
    await expect(displayButton(page, "Sensor")).toHaveAttribute("aria-pressed", "false");
    await expect(zoomValue(page)).toHaveText("×1");
    await expect.poll(async () => (await sensorCamera(page))?.visibleEntityCount, { message: "no entities shown in Camera mode" }).toBe(0);
    const start = (await sensorCamera(page))!;
    expect(start.display).toBe("camera");
    expect(start.zoom).toBe(1);
    // หน้าต่าง 3D หลักยังวาด object ของตัวเอง (Camera ซ่อนเฉพาะในหน้าต่างของมัน): ป้ายของดาวแสดงอยู่ (isShowing รวม show ของ data source)
    await expect.poll(() => mainLabelShown(page, SATELLITE), { message: "the main 3D window still draws the satellite" }).toBe(true);

    const fovAt1 = await shortSideFovDeg(page);
    expect(fovAt1, "short-side fov at ×1").not.toBeNull();

    // Zoom In สองครั้ง = ×4: fov ด้านสั้น = 1/4 ของ ×1 (คลาดไม่เกิน 1%) และกล้องยังอยู่ที่ดาว (< 1 ม.) ส่วนหน้าต่างอื่นไม่ถูกแตะ
    await zoomIn(page).click();
    await expect(zoomValue(page)).toHaveText("×2");
    await expectShortSideFov(page, fovAt1! / 2, "at ×2");
    await zoomIn(page).click();
    await expect(zoomValue(page)).toHaveText("×4");
    await expectShortSideFov(page, fovAt1! / 4, "at ×4");
    await waitForCameraOnSatellite(page, "at ×4");
    const zoomed = (await sensorCamera(page))!;
    expect(zoomed.zoom).toBe(4);
    expect(zoomed.display).toBe("camera");
    expect(zoomed.visibleEntityCount).toBe(0);
    expect(await cameraDistanceM(page), "camera-to-satellite distance at ×4 (m)").toBeLessThan(1);
    // ทิศกล้องไม่เปลี่ยนจากการซูม (ยังชี้ศูนย์กลางโลกแบบเดิม)
    const dot = zoomed.direction[0] * start.direction[0] + zoomed.direction[1] * start.direction[1] + zoomed.direction[2] * start.direction[2];
    expect(Math.acos(Math.min(1, dot)) * DEG, "angle between the ×1 and ×4 view directions (deg)").toBeLessThan(0.05);

    // HUD: บรรทัดมุมกว้างบอก ×4 แหล่งภาพคือ Natural Earth II (ออฟไลน์) และยังไม่ถึง ×8 จึงไม่มีคำแนะนำ Globe Manager
    await expect(hud(page)).toContainText(/FOV [0-9.]+° ×4/);
    await expect(hud(page)).toContainText(msg("sensorView.hudImageryOffline"));
    await expect(hud(page)).not.toContainText(msg("sensorView.hintGlobeManager"));

    // Zoom Out ด้วยล้อเมาส์ (deltaY > 0 = ออก ทีละขั้น) ไม่ใช่ Step Backward และไม่เปลี่ยนตำแหน่งกล้อง
    const box = (await page.getByTestId("sensor-view").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 100);
    await expect(zoomValue(page)).toHaveText("×2");
    await expectShortSideFov(page, fovAt1! / 2, "after the wheel");
    await waitForCameraOnSatellite(page, "after the wheel");

    // Zoom Out อีกครั้ง = ×1 (ปุ่มปิดใช้ที่ปลายล่าง) fov กลับเป็นค่าตั้งต้น
    await zoomOut(page).click();
    await expect(zoomValue(page)).toHaveText("×1");
    await expect(zoomOut(page)).toBeDisabled();
    await expectShortSideFov(page, fovAt1!, "back at ×1");
    await waitForCameraOnSatellite(page, "back at ×1");
  });

  test("Sensor display shows the scenario objects in this window only, and Camera hides them again", async ({ page }) => {
    await openScenario(page, "E2E");
    await waitForScene(page);
    await openSensorView(page);
    await waitForCameraOnSatellite(page, "at ×1");
    await expect.poll(async () => (await sensorCamera(page))?.visibleEntityCount).toBe(0);

    await displayButton(page, "Sensor").click();
    await expect(displayButton(page, "Sensor")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await sensorCamera(page))?.visibleEntityCount, { message: "entities shown in Sensor mode" }).toBeGreaterThan(0);
    expect((await sensorCamera(page))!.display).toBe("sensor");
    // โหมด Sensor วาดวงขอบกรวยบนภาพ (SVG) ส่วนโหมด Camera ไม่วาด
    await expect(sensorView(page).locator("svg.sensor-view-cone")).toHaveCount(1);

    await displayButton(page, "Camera").click();
    await expect(displayButton(page, "Camera")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await sensorCamera(page))?.visibleEntityCount, { message: "entities hidden again in Camera mode" }).toBe(0);
    await expect(sensorView(page).locator("svg.sensor-view-cone")).toHaveCount(0);
    await expect.poll(() => mainLabelShown(page, SATELLITE), { message: "the main 3D window still draws the satellite" }).toBe(true);
    await waitForCameraOnSatellite(page, "after switching display modes");
  });

  test("at ×8 in Camera mode with online imagery off, the HUD points to Globe Manager", async ({ page }) => {
    await openScenario(page, "E2E");
    await waitForScene(page);
    await openSensorView(page);
    await waitForCameraOnSatellite(page, "at ×1");

    for (let i = 0; i < 3; i++) await zoomIn(page).click();
    await expect(zoomValue(page)).toHaveText("×8");
    await expect(hud(page)).toContainText(msg("sensorView.hintGlobeManager"));
    await expect(hud(page)).toContainText(/FOV [0-9.]+° ×8/);
    // Sensor ไม่แสดงคำแนะนำ (คำแนะนำเฉพาะโหมด Camera)
    await displayButton(page, "Sensor").click();
    await expect(hud(page)).not.toContainText(msg("sensorView.hintGlobeManager"));
  });

  test("zooms to ×8192 with 13 clicks of Zoom In: the short-side fov is 1/8192 of ×1, the boresight does not move and the HUD shows the ground width", async ({ page }) => {
    await openScenario(page, "E2E");
    await waitForScene(page);
    await openSensorView(page);
    await waitForCameraOnSatellite(page, "at ×1");

    const start = (await sensorCamera(page))!;
    const fovAt1 = (await shortSideFovDeg(page))!;
    expect(fovAt1, "short-side fov at ×1").not.toBeNull();
    // ×1 มีบรรทัดความกว้างพื้นที่แล้ว (ภาพกว้างกว่าจานโลก = กว้างถึงขอบฟ้า) ยังไม่ต่ำกว่า 1 km
    expect(await groundWidthKm(page), "ground width at ×1 (km)").toBeGreaterThan(1000);

    // ZOOM_STEPS มี 14 ค่า (1, 2, 4, ..., 8192) จึงกด Zoom In 13 ครั้งถึงปลายทาง ทีละขั้นเป็นเลขยกกำลังสองตามลำดับ
    for (let i = 1; i <= 13; i++) {
      await expect(zoomIn(page)).toBeEnabled();
      await zoomIn(page).click();
      await expect(zoomValue(page)).toHaveText(`×${2 ** i}`);
    }
    await expect(zoomValue(page)).toHaveText("×8192");
    await expect(zoomIn(page), "Zoom In at the top step").toBeDisabled();
    await expect(zoomOut(page)).toBeEnabled();

    // มุมกว้างด้านสั้น = 1/8192 ของ ×1 (คลาดไม่เกิน 1%) กล้องยังอยู่ที่ดาว และทิศกล้องคลาดจาก ×1 ไม่เกิน 0.01° (global constraint ข้อ ซูม ×8192)
    await expectShortSideFov(page, fovAt1 / 8192, "at ×8192");
    await waitForCameraOnSatellite(page, "at ×8192");
    const zoomed = (await sensorCamera(page))!;
    expect(zoomed.zoom).toBe(8192);
    expect(zoomed.display).toBe("camera");
    expect(zoomed.visibleEntityCount).toBe(0);
    const dot = zoomed.direction[0] * start.direction[0] + zoomed.direction[1] * start.direction[1] + zoomed.direction[2] * start.direction[2];
    expect(Math.acos(Math.min(1, dot)) * DEG, "angle between the ×1 and ×8192 view directions (deg)").toBeLessThan(0.01);

    // HUD: มุมกว้างมี 4 ทศนิยม (0.00xx ไม่ปัดเป็น 0.00) และ ×8192 ; บรรทัดความกว้างพื้นที่ที่จุดใต้ดาวเป็น km ตรงกับ 2·h·tan(fov ด้านสั้น / 2) (h จากตำแหน่งกล้อง, คลาดไม่เกิน 3%)
    await expect(hud(page)).toContainText(/FOV 0\.00[0-9]{2}° ×8192/);
    const expectedKm = expectedGroundWidthKm(zoomed.position, (await shortSideFovDeg(page))!);
    expect(expectedKm, "expected ground width at ×8192 (km, from the camera height)").toBeGreaterThan(0.5);
    expect(expectedKm).toBeLessThan(3);
    await expect
      .poll(async () => {
        const km = await groundWidthKm(page);
        return km === null ? Number.POSITIVE_INFINITY : Math.abs(km - expectedKm) / expectedKm;
      }, { message: `HUD ground width at ×8192 (expected about ${expectedKm.toFixed(2)} km)` })
      .toBeLessThanOrEqual(0.03);
    // สวิตช์ภาพออนไลน์ปิด: HUD ยังบอกภาพ Natural Earth II ออฟไลน์ ไม่มีข้อความ "ภาพละเอียดสุดของแหล่งนี้แล้ว" (ไม่มีชั้นออนไลน์) และยังแนะนำ Globe Manager
    await expect(hud(page)).toContainText(msg("sensorView.hudImageryOffline"));
    await expect(hud(page)).not.toContainText("ภาพละเอียดสุดของแหล่งนี้แล้ว");
    await expect(hud(page)).toContainText(msg("sensorView.hintGlobeManager"));

    // ×1024 (ขั้นที่ 11) ตามที่ spec บอก ≈ 10 km ที่ความสูงของดาว GPS: ถอยหลังสามขั้นแล้วบรรทัดความกว้างตรงกับสูตรเดียวกัน (กว้างกว่า ×8192 แปดเท่า)
    for (let i = 0; i < 3; i++) await zoomOut(page).click();
    await expect(zoomValue(page)).toHaveText("×1024");
    await expectShortSideFov(page, fovAt1 / 1024, "at ×1024");
    const expectedKm1024 = expectedGroundWidthKm((await sensorCamera(page))!.position, (await shortSideFovDeg(page))!);
    expect(expectedKm1024 / expectedKm, "ground width ratio ×1024 / ×8192").toBeCloseTo(8, 1);
    await expect
      .poll(async () => {
        const km = await groundWidthKm(page);
        return km === null ? Number.POSITIVE_INFINITY : Math.abs(km - expectedKm1024) / expectedKm1024;
      }, { message: `HUD ground width at ×1024 (expected about ${expectedKm1024.toFixed(2)} km)` })
      .toBeLessThanOrEqual(0.03);
    await waitForCameraOnSatellite(page, "at ×1024");
  });
});

// ---------- Globe Manager ----------

/** ชื่อบนจอของชั้นภาพ ตามลำดับใน catalog ของ server (draw order: ชั้นหลังทับชั้นก่อน) ต่อจาก Natural Earth II ที่เป็นฐานเสมอ */
const GIBS_TITLES = [
  "Blue Marble",
  "VIIRS NOAA-20 True Color",
  "VIIRS Suomi NPP True Color",
  "MODIS Terra True Color",
  "Himawari-9 Red Visible",
  "Himawari-9 Clean Infrared",
  "GOES-East GeoColor",
  "GOES-West GeoColor",
];

const EOX_TITLE = "Sentinel-2 cloudless 2024";
const OSM_TITLE = "OpenStreetMap";

/** สี่กลุ่มของ Globe Manager ตามลำดับบนจอ: ป้ายสวิตช์, host ในกล่องยืนยัน และช่องของสวิตช์ใน online_imagery (ของ server) */
const SOURCES = [
  { label: "Online imagery (NASA GIBS)", host: "gibs.earthdata.nasa.gov", field: "enabled" },
  { label: "Online imagery (Sentinel-2 cloudless)", host: "tiles.maps.eox.at", field: "eox" },
  { label: "Online imagery (OpenStreetMap)", host: "tile.openstreetmap.org", field: "osm" },
  { label: "Online imagery (Cesium ion)", host: "api.cesium.com", field: "ion" },
] as const;

const onlineSwitch = (page: Page, label: string) => page.getByRole("checkbox", { name: label, exact: true });
const globeRows = (page: Page) => page.locator(".globe-table tbody tr");
const globeGroups = (page: Page) => page.locator(".globe-group");

interface SettingsDoc {
  daily: Record<string, unknown>;
  cesium_ion_token: string;
  online_imagery: { enabled: boolean; eox: boolean; osm: boolean; ion: boolean };
}

const ALL_OFF = { enabled: false, eox: false, osm: false, ion: false };

/** เอกสารค่าตั้งทั้งก้อนจาก server (GET /api/settings: ใช้ page.request จึงไม่ผ่านตัวนับ request ของ browser) */
async function settingsOnServer(page: Page): Promise<SettingsDoc> {
  const reply = await page.request.get("/api/settings");
  expect(reply.ok()).toBe(true);
  return (await reply.json()) as SettingsDoc;
}

test.describe("Globe Manager", () => {
  test("has four source groups (GIBS, Sentinel-2 cloudless, OpenStreetMap, Cesium ion); every switch asks for its own consent and Cancel changes nothing", async ({ page }) => {
    await openScenario(page, "E2E");
    // ข้อมูลของ e2e: สี่สวิตช์ปิดและไม่มี token (ไม่ใส่ token ใด ๆ ใน test) ทุกครั้งที่ Cancel ต้องได้เอกสารเดิมทั้งก้อน
    const settingsBefore = await settingsOnServer(page);
    expect(settingsBefore.online_imagery, "online_imagery in the e2e data").toEqual(ALL_OFF);
    expect(settingsBefore.cesium_ion_token, "cesium_ion_token in the e2e data").toBe("");
    // รายการชั้นของ server ตรงกับที่หน้าต่างแสดง (GET /api/imagery/layers ไม่ต่อเน็ต: ใช้ได้เสมอแม้สวิตช์ปิด)
    const layersReply = await page.request.get("/api/imagery/layers");
    expect(layersReply.ok()).toBe(true);
    const layers = (await layersReply.json()) as {
      enabled: boolean;
      sources: Record<string, boolean>;
      layers: { title: string; source: string }[];
    };
    expect(layers.enabled).toBe(false);
    expect(layers.sources).toEqual({ gibs: false, eox: false, osm: false, ion: false });
    // server ส่ง 9 ชั้น (GIBS 8 + EOX 1) ; OpenStreetMap และ Cesium ion ไม่มีใน catalog ของ server (browser ดึงตรง)
    expect(layers.layers).toHaveLength(9);
    expect(layers.layers.filter((l) => l.source === "gibs").map((l) => l.title)).toEqual(GIBS_TITLES);
    expect(layers.layers.filter((l) => l.source === "eox").map((l) => l.title)).toEqual([EOX_TITLE]);

    await page.getByRole("menuitem", { name: "View", exact: true }).click();
    await page.getByRole("menuitem", { name: "Globe Manager", exact: true }).click();

    // สี่กลุ่มตามลำดับ แต่ละกลุ่มมีสวิตช์ของตัวเอง ปิดอยู่ทั้งหมด
    await expect(globeGroups(page)).toHaveCount(4);
    for (const [i, source] of SOURCES.entries()) {
      await expect(globeGroups(page).nth(i)).toHaveAttribute("aria-label", source.label);
      await expect(globeGroups(page).nth(i).getByRole("checkbox", { name: source.label, exact: true })).not.toBeChecked();
    }
    // 11 แถว: Natural Earth II (ฐาน ปิดไม่ได้ อยู่นอกกลุ่ม) + 8 ชั้น GIBS + Sentinel-2 cloudless + OpenStreetMap ตามลำดับของกลุ่ม; กลุ่ม Cesium ion ไม่มีตาราง
    await expect(globeRows(page)).toHaveCount(11);
    await expect(page.locator(".globe-table tbody th[scope=row]")).toHaveText(["Natural Earth II", ...GIBS_TITLES, EOX_TITLE, OSM_TITLE]);
    await expect(globeGroups(page).nth(0).locator("tbody th[scope=row]")).toHaveText(GIBS_TITLES);
    await expect(globeGroups(page).nth(1).locator("tbody th[scope=row]")).toHaveText([EOX_TITLE]);
    await expect(globeGroups(page).nth(2).locator("tbody th[scope=row]")).toHaveText([OSM_TITLE]);
    await expect(globeGroups(page).nth(3).locator("table")).toHaveCount(0);
    // สวิตช์ปิด: ชั้นของแหล่งนั้นใช้ไม่ได้ (Show ปิดใช้) ส่วน Natural Earth II ติ๊กไว้และปิดไม่ได้เสมอ
    await expect(page.getByRole("checkbox", { name: "Natural Earth II Show", exact: true })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Natural Earth II Show", exact: true })).toBeDisabled();
    for (const title of [...GIBS_TITLES, EOX_TITLE, OSM_TITLE]) {
      await expect(page.getByRole("checkbox", { name: `${title} Show`, exact: true }), `${title} Show while its switch is off`).toBeDisabled();
    }
    // กลุ่ม Cesium ion: ช่อง token เป็นช่องรหัสผ่านที่ว่างอยู่ (ไม่แสดงค่าที่บันทึกไว้) และตัวเลือก asset ปิดใช้ขณะสวิตช์ปิด
    await expect(page.getByLabel("Cesium Ion Token", { exact: true })).toHaveAttribute("type", "password");
    await expect(page.getByLabel("Cesium Ion Token", { exact: true })).toHaveValue("");
    await expect(page.getByRole("radiogroup", { name: "Cesium ion asset", exact: true }).getByRole("radio").first()).toBeDisabled();

    // ติ๊กสวิตช์ของแต่ละแหล่ง -> กล่องยืนยันภาษาไทยที่บอก host ของแหล่งนั้น -> Cancel: ไม่เปลี่ยนค่า (server ยังปิดทั้งสี่ช่อง และช่องติ๊กกลับเป็นไม่ติ๊ก)
    // หน้าต่างลอยของ Globe Manager ก็มี role dialog (dockview): เลือกกล่องยืนยันของแอปจากชื่อ "Confirm"
    const dialog = page.getByRole("dialog", { name: "Confirm", exact: true });
    for (const source of SOURCES) {
      await onlineSwitch(page, source.label).click();
      await expect(dialog, `${source.host} confirmation`).toBeVisible();
      await expect(dialog).toContainText(source.host);
      for (const other of SOURCES.filter((s) => s.host !== source.host)) await expect(dialog).not.toContainText(other.host);
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(onlineSwitch(page, source.label)).not.toBeChecked();
      expect(await settingsOnServer(page), `GET /api/settings after Cancel of ${source.host}`).toEqual(settingsBefore);
    }
    // GIBS: บอกที่เก็บ data/imagery ; OpenStreetMap และ Cesium ion: browser ต่อเอง (ไม่มีที่เก็บของ server)
    await onlineSwitch(page, SOURCES[0].label).click();
    await expect(dialog).toContainText("data/imagery");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await onlineSwitch(page, SOURCES[2].label).click();
    await expect(dialog).toContainText("browser");
    await expect(dialog).not.toContainText("data/imagery");
    // Esc = Cancel เช่นกัน
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    for (const source of SOURCES) await expect(onlineSwitch(page, source.label)).not.toBeChecked();
    expect(await settingsOnServer(page), "GET /api/settings after Escape").toEqual(settingsBefore);
    const after = await page.request.get("/api/imagery/layers");
    const afterDoc = (await after.json()) as { enabled: boolean; sources: Record<string, boolean> };
    expect(afterDoc.enabled).toBe(false);
    expect(afterDoc.sources).toEqual({ gibs: false, eox: false, osm: false, ion: false });
    // ทุกอย่างข้างบนเกิดโดยไม่มี request ใดไป /api/imagery/tiles (ตรวจตอนจบ test ด้วย fixture guards)
  });
});
