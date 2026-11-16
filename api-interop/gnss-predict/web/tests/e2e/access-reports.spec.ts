// Access tool, หน้าต่างรายงาน/กราฟ, Report & Graph Manager และ Static/Animate Highlight ในหน้าต่าง 2D (access spec §4–§6, งาน 15)
// บน data fixture ของ build_fixture.py (ไม่ต่อเน็ต ไม่มี GMAT):
// - E2E_ACCESS: ผลของ THBK พร้อม แต่ไม่มี access เลย test ที่ Compute/Clear/Remove คืนเอกสารเดิมเมื่อจบ (saveScenario)
// - E2E_SAVE: แบบเดียวกัน ใช้กับ test ที่ File → Save (workbook ที่เขียนไม่ไปถึง scenario ที่ test อื่นเปิด)
// - E2E_DATELINE: 12 ชั่วโมง Facility DATELINE (29.3 N, 179.5 E) ดาว C09 ข้ามเส้น 180° ระหว่าง access (ราว 11:21Z)
// - E2E_NORES: ไม่มีผล access ของแม่แบบเป็น computed: false (Task 11 ruling (a): แสดงเฉพาะ access ที่ Compute แล้ว)
// ไม่มี test ใดเรียก /api/orbits/fetch, /api/daily/run หรือ /validate

import { readFile } from "node:fs/promises";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { formatTime } from "../../src/time/format";
import { ephemHash, expect, openScenario, saveScenario, test, toolButton, treeRow, waitForScene, WRITE_HEADERS } from "./fixtures";

const SC = "E2E_ACCESS";
const THBK = "*/Facility/THBK";
const GPS = "*/Constellation/GPS";
const G01_TITLE = "THBK-To-G01";
const HEADERS = ["Access", "Start Time (UTCG)", "Stop Time (UTCG)", "Duration (sec)"];
/** ใน access ของ G01 จาก THBK (00:38:09.8Z ถึง 06:00Z) */
const IN_G01 = "2026-11-10T01:00:00Z";

// ---------- API ----------

async function postAccess(request: APIRequestContext, sc: string, action: "compute" | "clear" | "remove", body: object): Promise<void> {
  const doc = await request.get(`/api/scenarios/${sc}`);
  const reply = await request.post(`/api/scenarios/${sc}/access/${action}`, { data: body, headers: { ...WRITE_HEADERS, "If-Match": doc.headers().etag } });
  expect(reply.ok(), `${action} on ${sc}: ${await reply.text()}`).toBe(true);
}

/** ช่วงเวลาที่ server ตอบของคู่ (from, to) ต่อดาว (ดาวที่ซ่อนไม่อยู่ในคำตอบ) */
async function intervals(request: APIRequestContext, sc: string, from: string, to: string): Promise<Record<string, { start: string; stop: string }[]>> {
  const reply = await request.get(`/api/scenarios/${sc}/access/intervals?${new URLSearchParams({ from, to })}`);
  expect(reply.ok()).toBe(true);
  return reply.json();
}

interface IntervalsJson {
  intervals: Record<string, { start: string; stop: string; duration_s: number }[]>;
}

/** intervals.json ของผล analyze ของ Facility (อ่านผ่าน route ของไฟล์ใน bundle) */
async function intervalsJson(request: APIRequestContext, sc: string, facility: string): Promise<IntervalsJson> {
  const results = await (await request.get(`/api/scenarios/${sc}/results`)).json();
  const hash = results.access[facility].hash as string;
  const reply = await request.get(`/api/scenarios/${sc}/access/${facility}/${hash}/intervals.json`);
  expect(reply.ok()).toBe(true);
  return reply.json();
}

// ---------- หน้าเว็บ ----------

const hooks = {
  reportRows: (page: Page, id: string) => page.evaluate((p) => window.__gnssStudioTest!.reportRows(p), id),
  graphState: (page: Page, id: string) => page.evaluate((p) => window.__gnssStudioTest!.graphState(p), id),
  overlays: (page: Page) => page.evaluate(() => window.__gnssStudioTest!.overlays2d()),
  accessLines: (page: Page, view: "3d" | "2d") => page.evaluate((v) => window.__gnssStudioTest!.accessLines(v), view),
  setTime: (page: Page, iso: string) => page.evaluate((t) => window.__gnssStudioTest!.setTime(t), iso),
};

/** เมนู (เมนูบนสุดหรือ Export ของหน้าต่างรายงาน) แล้วรายการในนั้น: ชื่อรายการที่มีคีย์ลัดต่อท้าย (Save Ctrl+S) ส่งเป็น RegExp */
async function menu(page: Page, top: string, item: string | RegExp): Promise<void> {
  await page.getByRole("menuitem", { name: top, exact: true }).click();
  await page.getByRole("menuitem", typeof item === "string" ? { name: item, exact: true } : { name: item }).click();
}

/** เลือก Facility ใน Object Browser แล้ว Analysis → Access... (Access For = Facility นั้น) */
async function openAccessTool(page: Page, facility = "THBK"): Promise<Locator> {
  await treeRow(page, `*/Facility/${facility}`).click();
  await menu(page, "Analysis", "Access...");
  const tool = page.locator(".access-tool");
  await expect(tool.locator(".access-for input")).toHaveValue(`Facility/${facility}`);
  return tool;
}

/** ปิด Access tool (หน้าต่างลอยบังแถบเครื่องมือของหน้าต่างรายงานและขอบซ้ายของแผนที่ 2D) */
async function closeAccessTool(page: Page): Promise<void> {
  await page.locator('[data-tab-panel-id="accessTool"] .dv-default-tab-action').click();
  await expect(page.locator(".access-tool")).toHaveCount(0);
}

const tick = (tool: Locator, name: string) => tool.getByRole("checkbox", { name, exact: true });
const timelineRows = (page: Page, prefix: string) => page.locator(`[data-row^="${prefix}"]`);
const tabOf = (page: Page, title: string) => page.locator(".dv-default-tab-content").filter({ hasText: title });
const reportRow = (page: Page) => page.locator("tr.rpt-row");

/** เวลาแบบ UTCG ที่หน้าต่างรายงานแสดง */
const utcg = (iso: string): string => formatTime(new Date(iso), "UTCG", "+00:00");

/** แถวข้อมูลของรายงาน (ไม่นับหัวส่วน หัวคอลัมน์ และสถิติ): แถวที่ช่องแรกเป็นเลขลำดับ */
const dataRows = (rows: string[][]): string[][] => rows.filter((r) => r.length === HEADERS.length && /^\d+$/.test(r[0]));

// ---------- Access tool และ Timeline ----------

test("compute THBK to GPS adds one timeline row per shown GPS satellite; Clear hides the rows and the lines again", async ({ page, request }) => {
  const restore = await saveScenario(request, SC);
  try {
    const expected = Object.keys(await intervals(request, SC, THBK, GPS)).length;
    expect(expected).toBeGreaterThan(0);

    await openScenario(page, SC);
    await waitForScene(page);
    await expect(timelineRows(page, "THBK-To-")).toHaveCount(0);
    expect(await hooks.accessLines(page, "3d")).toBe(0);
    expect(await hooks.accessLines(page, "2d")).toBe(0);

    const tool = await openAccessTool(page);
    await tick(tool, "GPS").check();
    await tool.getByRole("button", { name: "Compute", exact: true }).click();
    await expect(timelineRows(page, "THBK-To-G")).toHaveCount(expected);
    await expect(timelineRows(page, "THBK-To-")).toHaveCount(expected);
    // เส้น access: เฉพาะดาวของ GPS ที่มีผล (G01) ทั้งในหน้าต่าง 3D และ 2D
    await expect.poll(() => hooks.accessLines(page, "3d")).toBe(1);
    await expect.poll(() => hooks.accessLines(page, "2d")).toBe(1);

    // Clear = computed: false → ไม่มีแถวและไม่มีเส้น (ผลยังอยู่)
    await tool.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(timelineRows(page, "THBK-To-")).toHaveCount(0);
    await expect.poll(() => hooks.accessLines(page, "3d")).toBe(0);
    await expect.poll(() => hooks.accessLines(page, "2d")).toBe(0);
    const doc = await (await request.get(`/api/scenarios/${SC}`)).json();
    expect(doc.accesses).toEqual([expect.objectContaining({ from: THBK, to: [GPS], computed: false })]);
  } finally {
    await restore();
  }
});

test("an access that is not computed has no Timeline row (E2E_NORES); marking it computed shows its row", async ({ page, request }) => {
  const sc = "E2E_NORES";
  const original = await (await request.get(`/api/scenarios/${sc}`)).json();
  expect(original.accesses.length).toBeGreaterThan(0);
  expect(original.accesses.every((a: { computed?: boolean }) => a.computed !== true)).toBe(true);
  const restore = await saveScenario(request, sc);
  try {
    await openScenario(page, sc);
    await expect(page.locator("canvas.tl-canvas")).toBeVisible();
    // ตัวเทียบ: access เดียวกันที่ computed = true มีแถว (ไม่มีผล = แถวพร้อมหมายเหตุ) แล้วกลับเป็น false = แถวหายอีก
    const put = async (computed: boolean) => {
      const latest = await request.get(`/api/scenarios/${sc}`);
      const doc = await latest.json();
      doc.accesses = doc.accesses.map((a: object) => ({ ...a, computed }));
      const reply = await request.put(`/api/scenarios/${sc}`, { data: doc, headers: { ...WRITE_HEADERS, "If-Match": latest.headers().etag } });
      expect(reply.ok()).toBe(true);
    };
    await expect(timelineRows(page, "THBK-To-")).toHaveCount(0);
    await put(true);
    await expect(timelineRows(page, "THBK-To-")).toHaveCount(original.accesses.length);
    await put(false);
    await expect(timelineRows(page, "THBK-To-")).toHaveCount(0);
  } finally {
    await restore();
  }
});

// ---------- หน้าต่างรายงาน ----------

test("access report of G01 matches intervals.json", async ({ page, request }) => {
  const stored = (await intervalsJson(request, SC, "THBK")).intervals.G01;
  expect(stored.length).toBeGreaterThan(0);

  await openScenario(page, SC);
  const tool = await openAccessTool(page);
  await tick(tool, "G01").check();
  await tool.getByRole("group", { name: "Reports" }).getByRole("button", { name: "Access...", exact: true }).click();
  await expect(tabOf(page, `${G01_TITLE}: Access`)).toBeVisible();

  await expect.poll(async () => dataRows(await hooks.reportRows(page, "report")).length).toBe(stored.length);
  const rows = await hooks.reportRows(page, "report");
  expect(rows[0]).toEqual([G01_TITLE]);
  expect(rows[1]).toEqual(HEADERS);
  expect(dataRows(rows)).toEqual(stored.map((iv, i) => [String(i + 1), utcg(iv.start), utcg(iv.stop), iv.duration_s.toFixed(3)]));
});

test("access report shows within 2 seconds", async ({ page }) => {
  await openScenario(page, SC);
  const tool = await openAccessTool(page);
  await tick(tool, "G01").check();
  const started = Date.now();
  await tool.getByRole("group", { name: "Reports" }).getByRole("button", { name: "Access...", exact: true }).click();
  await expect(reportRow(page).first()).toBeVisible({ timeout: 5_000 });
  const elapsed = Date.now() - started;
  expect(elapsed).toBeLessThan(2000);
});

test("export csv has unit headers", async ({ page }) => {
  await openScenario(page, SC);
  const tool = await openAccessTool(page);
  await tick(tool, "G01").check();
  await tool.getByRole("group", { name: "Reports" }).getByRole("button", { name: "Access...", exact: true }).click();
  await expect(reportRow(page).first()).toBeVisible();
  await closeAccessTool(page);

  const download = page.waitForEvent("download");
  await menu(page, "Export", "To Excel or CSV Format");
  const file = await (await download).path();
  const text = await readFile(file, "utf-8");
  expect(text.split(/\r?\n/)[0]).toBe("Access,Start Time (UTCG),Stop Time (UTCG),Duration (sec)");
});

test("a report window and its Export Setup survive File → Save and reopening the scenario", async ({ page }) => {
  const sc = "E2E_SAVE";
  await openScenario(page, sc);
  const tool = await openAccessTool(page);
  await tick(tool, "G01").check();
  await tool.getByRole("group", { name: "Reports" }).getByRole("button", { name: "Access...", exact: true }).click();
  await expect(reportRow(page).first()).toBeVisible();
  await closeAccessTool(page);
  // Export Setup ของหน้าต่างนี้: Field Delimiter ";"
  await menu(page, "Export", "Setup...");
  const setup = page.getByRole("dialog", { name: "Export Setup" });
  await setup.getByLabel("Field Delimiter").fill(";");
  await setup.getByRole("button", { name: "OK", exact: true }).click();
  await expect(setup).toHaveCount(0);

  // GET /workbook ตอบ 200 (body null) แม้ยังไม่มี workbook: รอคำตอบของ PUT ที่ File → Save ส่งจริง ไม่งั้นการเปิดใหม่แข่งกับการบันทึก
  const workbookSaved = page.waitForResponse(
    (r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `/api/scenarios/${encodeURIComponent(sc)}/workbook`,
  );
  await menu(page, "File", /^Save(?! As)/);
  expect((await workbookSaved).ok()).toBe(true);

  await openScenario(page, sc);
  await expect(tabOf(page, `${G01_TITLE}: Access`)).toBeVisible();
  await expect(reportRow(page).first()).toBeVisible(); // สร้างรายงานใหม่หลังคืนหน้าต่าง
  const download = page.waitForEvent("download");
  await menu(page, "Export", "To Excel or CSV Format");
  const text = await readFile(await (await download).path(), "utf-8");
  expect(text.split(/\r?\n/)[0]).toBe("Access;Start Time (UTCG);Stop Time (UTCG);Duration (sec)");
});

// ---------- Report & Graph Manager: Dynamic Display และกราฟ polar ----------

/** R&G Manager → Object Type Access → THBK-To-G01 → style (ชื่อ, ชนิด) → Generate As → Generate... → OK */
async function generate(page: Page, style: string, kind: "report" | "graph", dynamic: boolean): Promise<void> {
  await menu(page, "Analysis", "Report & Graph Manager...");
  const rgm = page.locator(".rgm-main").locator("..");
  await rgm.getByLabel("Object Type").selectOption({ label: "Access" });
  await rgm.getByRole("option", { name: G01_TITLE, exact: true }).click();
  await rgm.locator(`[role="treeitem"][data-name="${style}"][data-kind="${kind}"]`).first().click();
  await rgm.getByRole("radio", { name: dynamic ? "Dynamic Display/Strip Chart" : "Report/Graph", exact: true }).check();
  await rgm.getByRole("button", { name: "Generate...", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Time Properties" });
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test("dynamic display of AER changes on Step Forward", async ({ page, request }) => {
  const restore = await saveScenario(request, SC);
  try {
    await postAccess(request, SC, "compute", { from: THBK, to: [GPS] });
    await openScenario(page, SC);
    await hooks.setTime(page, IN_G01);
    await generate(page, "AER", "report", true);
    await expect(tabOf(page, `${G01_TITLE}: AER`)).toBeVisible();

    // หนึ่งแถวของเวลาปัจจุบัน: Time, Azimuth, Elevation, Range
    const current = async () => (await hooks.reportRows(page, "report")).find((r) => r.length === 4 && r[0].endsWith("UTCG")) ?? null;
    await expect.poll(async () => (await current())?.[0] ?? null).toBe(utcg(IN_G01));
    const before = (await current())!;
    await toolButton(page, "Step Forward").click();
    await expect.poll(async () => (await current())?.[0] ?? null).not.toBe(before[0]);
    const after = (await current())!;
    expect(after[1]).not.toBe(before[1]); // Azimuth
    expect(after[2]).not.toBe(before[2]); // Elevation
  } finally {
    await restore();
  }
});

test("az el polar graph has the current time point inside the access and none outside it", async ({ page, request }) => {
  const restore = await saveScenario(request, SC);
  try {
    await postAccess(request, SC, "compute", { from: THBK, to: [GPS] });
    await openScenario(page, SC);
    await hooks.setTime(page, IN_G01);
    await generate(page, "Az El Polar", "graph", false);
    await expect.poll(async () => (await hooks.graphState(page, "graph"))?.type ?? null).toBe("polar90");
    await expect.poll(async () => (await hooks.graphState(page, "graph"))?.currentPoint ?? null).not.toBeNull();
    const [el, az] = (await hooks.graphState(page, "graph"))!.currentPoint!;
    expect(el).toBeGreaterThanOrEqual(10);
    expect(az).toBeGreaterThanOrEqual(0);
    expect(az).toBeLessThan(360);
    // ก่อน access ของ G01 (00:38Z) ไม่มีจุดปัจจุบัน
    await hooks.setTime(page, "2026-11-10T00:10:00Z");
    await expect.poll(async () => (await hooks.graphState(page, "graph"))?.currentPoint ?? null).toBeNull();
  } finally {
    await restore();
  }
});

// ---------- หน้าต่างกราฟ: สิ่งที่ ECharts วาดจริง (graphState().drawn) ----------

test("AER graph: the time line follows the toggle and the clock, and the azimuth wrap break survives LTTB", async ({ page }) => {
  await openScenario(page, SC);
  await hooks.setTime(page, IN_G01);
  const tool = await openAccessTool(page);
  await tick(tool, "G01").check();
  await tool.getByRole("group", { name: "Graphs" }).getByRole("button", { name: "AER...", exact: true }).click();
  await expect(tabOf(page, `${G01_TITLE}: AER`)).toBeVisible();
  const state = () => hooks.graphState(page, "graph");
  await expect.poll(async () => (await state())?.drawn?.timeLineMarks ?? null).toBe(1);
  expect((await state())!.timeLine).toBe(Date.parse(IN_G01));

  // Toggle Animation Timeline (setOption แบบ merge ที่ markLine.data = []) ล้างเส้นจริง แล้วเปิดกลับได้
  const toggle = page.getByRole("toolbar", { name: "Graph" }).getByRole("button", { name: "Toggle Animation Timeline", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await state())?.drawn?.timeLineMarks ?? null).toBe(0);
  expect((await state())!.timeLine).toBeNull();
  await toggle.click();
  await expect.poll(async () => (await state())?.drawn?.timeLineMarks ?? null).toBe(1);
  // เวลานอกแกน (ก่อน access) = ไม่มีเส้น
  await hooks.setTime(page, "2026-11-10T00:05:00Z");
  await expect.poll(async () => (await state())?.drawn?.timeLineMarks ?? null).toBe(0);

  // Azimuth ข้ามทิศเหนือระหว่าง access ของ G01: option มีจุด null ตรงจุดวน หน้าต่างแคบพอให้ LTTB ลดจุด แล้วจุดขาดยังอยู่
  const azimuth = async () => (await state())?.drawn?.series.find((s) => s.name === `${G01_TITLE} Azimuth`) ?? null;
  const wide = (await azimuth())!;
  expect(wide.inputBreaks).toBeGreaterThanOrEqual(1);
  await page.setViewportSize({ width: 640, height: 900 });
  await expect.poll(async () => {
    const s = await azimuth();
    return s !== null && s.drawn < s.input;
  }, { message: "LTTB samples the azimuth line in a narrow window" }).toBe(true);
  const narrow = (await azimuth())!;
  expect(narrow.breaks).toBeGreaterThanOrEqual(1);
});

// ---------- Static / Animate Highlight ในหน้าต่าง 2D ----------

async function switchScenario(page: Page, name: string): Promise<void> {
  const restoredBefore = await page.evaluate(() => window.__gnssStudioTest!.workbookRestoredAt());
  await menu(page, "File", "Open...");
  await page.locator("button.link-btn", { hasText: new RegExp(`^${name}$`) }).first().click();
  await expect.poll(() => page.evaluate(() => window.__gnssStudioTest!.workbookRestoredAt())).not.toBe(restoredBefore);
  await expect(page.getByRole("treeitem").first()).toBeVisible();
}

const highlights = async (page: Page) => {
  const o = await hooks.overlays(page);
  return o === null ? null : [o.highlightTracks, o.highlightBoxes];
};

test("2D highlights follow Compute, Clear, Remove and a scenario switch", async ({ page, request }) => {
  const restore = await saveScenario(request, SC);
  try {
    await openScenario(page, SC);
    await waitForScene(page);
    await hooks.setTime(page, IN_G01);
    await expect.poll(() => highlights(page)).toEqual([0, 0]);

    const tool = await openAccessTool(page);
    await tick(tool, "GPS").check();
    await tool.getByRole("checkbox", { name: "Static Highlight", exact: true }).check();
    await tool.getByRole("checkbox", { name: "Animate Highlight", exact: true }).check();
    await expect(tool.getByRole("checkbox", { name: "Inherit Settings from Scenario", exact: true })).not.toBeChecked();
    const compute = tool.getByRole("button", { name: "Compute", exact: true });
    // G01 มีหนึ่งช่วง (เส้นหนึ่งท่อน) และอยู่ใน access ณ IN_G01 (กรอบหนึ่งอัน); G22 ไม่มีผล
    await compute.click();
    await expect.poll(() => highlights(page)).toEqual([1, 1]);
    // นอก access ของ G01 กรอบหาย เส้นอยู่
    await hooks.setTime(page, "2026-11-10T00:10:00Z");
    await expect.poll(() => highlights(page)).toEqual([1, 0]);
    await hooks.setTime(page, IN_G01);
    await expect.poll(() => highlights(page)).toEqual([1, 1]);

    await tool.getByRole("button", { name: "Clear", exact: true }).click();
    await expect.poll(() => highlights(page)).toEqual([0, 0]);
    await compute.click();
    await expect.poll(() => highlights(page)).toEqual([1, 1]);

    // สลับ scenario ในแอป: ไม่มี highlight ค้างจาก scenario เดิม; กลับมาแล้วได้ของ scenario นี้คืน
    await switchScenario(page, "E2E_DATELINE");
    await expect.poll(() => highlights(page)).toEqual([0, 0]);
    await switchScenario(page, SC);
    await hooks.setTime(page, IN_G01);
    await expect.poll(() => highlights(page)).toEqual([1, 1]);

    const again = await openAccessTool(page);
    await tick(again, "GPS").check();
    await again.getByRole("button", { name: "Remove", exact: true }).click();
    await expect.poll(() => highlights(page)).toEqual([0, 0]);
    expect((await (await request.get(`/api/scenarios/${SC}`)).json()).accesses).toEqual([]);
  } finally {
    await restore();
  }
});

/**
 * คอลัมน์ (x) ของ canvas หน้าต่าง 2D ที่ภาพ a กับ b ต่างกัน (ภาพ PNG ทั้งสองขนาดเท่ากัน): ถอดรหัสในหน้าเว็บด้วย createImageBitmap
 * นับเฉพาะพิกเซลที่ต่างชัด (ผลรวมผลต่าง RGB > 60)
 */
async function differingColumns(page: Page, a: Buffer, b: Buffer): Promise<number[]> {
  return page.evaluate(async ([pa, pb]) => {
    const pixels = async (b64: string) => {
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    };
    const [ia, ib] = await Promise.all([pixels(pa), pixels(pb)]);
    const columns = new Set<number>();
    for (let y = 0; y < ia.height; y++) {
      for (let x = 0; x < ia.width; x++) {
        const i = (y * ia.width + x) * 4;
        const d = Math.abs(ia.data[i] - ib.data[i]) + Math.abs(ia.data[i + 1] - ib.data[i + 1]) + Math.abs(ia.data[i + 2] - ib.data[i + 2]);
        if (d > 60) columns.add(x);
      }
    }
    return [...columns].sort((p, q) => p - q);
  }, [a.toString("base64"), b.toString("base64")] as const);
}

test("a Static Highlight across the antimeridian is drawn at both map edges, not across the map", async ({ page, request }) => {
  const sc = "E2E_DATELINE";
  const DATELINE = "*/Facility/DATELINE";
  const C09 = "*/Satellite/C09";
  const [interval] = (await intervals(request, sc, DATELINE, C09)).C09;
  expect(interval).toBeDefined();
  // จุดใต้ดาวตลอดช่วง access: ข้ามจาก +180 ไป -180 จริง (กรณีนี้เป็นกรณีข้ามเส้นแบ่งวัน)
  const lla = await request.get(`/api/scenarios/${sc}/data?${new URLSearchParams([
    ["object", C09], ["provider", "LLA State"], ["group", "Fixed"], ["elements", "Time"], ["elements", "Lon"], ["start", interval.start], ["stop", interval.stop],
  ])}`);
  expect(lla.ok()).toBe(true);
  const lons = ((await lla.json()).rows as [string, number][]).map((r) => r[1]);
  const east = lons.filter((l) => l > 0);
  const west = lons.filter((l) => l < 0);
  expect(east.length).toBeGreaterThan(0);
  expect(west.length).toBeGreaterThan(0);
  const eastMin = Math.min(...east);
  const westMax = Math.max(...west);
  expect(eastMin).toBeGreaterThan(150);
  expect(westMax).toBeLessThan(-150);

  const restore = await saveScenario(request, sc);
  try {
    await openScenario(page, sc);
    await waitForScene(page);
    const tool = await openAccessTool(page, "DATELINE");
    await tick(tool, "C09").check();
    await tool.getByRole("checkbox", { name: "Static Highlight", exact: true }).check();
    await tool.getByRole("checkbox", { name: "Show Animate Line", exact: true }).uncheck(); // ภาพที่ต่างกันมีแค่ highlight
    await tool.getByRole("button", { name: "Compute", exact: true }).click();
    await expect.poll(() => highlights(page)).toEqual([1, 0]);
    expect(await hooks.accessLines(page, "2d")).toBe(0);
    await closeAccessTool(page);

    // ตำแหน่ง x ของลองจิจูดในหน้าต่าง 2D จาก Facility สองแห่ง (THBK 100.78 E, DATELINE 179.5 E)
    const at = (name: string) => page.evaluate((n) => window.__gnssStudioTest!.entityScreenPosition2d(n), name);
    await expect.poll(async () => (await at("DATELINE")) !== null && (await at("THBK")) !== null).toBe(true);
    const [xd] = (await at("DATELINE"))!;
    const [xt] = (await at("THBK"))!;
    const perDeg = (xd - xt) / (179.5 - 100.781151);
    const xOf = (lon: number) => xt + (lon - 100.781151) * perDeg;
    expect(perDeg).toBeGreaterThan(0);

    const canvas = page.getByTestId("g2d-view").locator("canvas").first();
    // ภาพนิ่ง: สองภาพติดกันเหมือนกัน
    const settled = async (): Promise<Buffer> => {
      let last = await canvas.screenshot();
      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(300);
        const next = await canvas.screenshot();
        if (next.equals(last)) return next;
        last = next;
      }
      return last;
    };
    const withTrack = await settled();
    // Clear ผ่าน API (Access tool ปิดแล้ว) หน้าเว็บรับ doc ใหม่ทาง event ของ scenario
    await postAccess(request, sc, "clear", { from: DATELINE, to: [C09] });
    await expect.poll(() => highlights(page)).toEqual([0, 0]);
    const without = await settled();

    const columns = await differingColumns(page, withTrack, without);
    // ปลายตะวันออก (eastMin..180) และปลายตะวันตก (-180..westMax) มีเส้น; ช่วงกลางแผนที่ไม่มีเส้นพาดข้าม
    const margin = 4; // พิกเซล: ความหนาเส้น 4 px และขอบ antialias
    expect(columns.filter((x) => x >= xOf(eastMin) - margin && x <= xOf(180) + margin).length).toBeGreaterThan(0);
    expect(columns.filter((x) => x >= xOf(-180) - margin && x <= xOf(westMax) + margin).length).toBeGreaterThan(0);
    const across = columns.filter((x) => x > xOf(westMax) + margin && x < xOf(eastMin) - margin);
    expect(across, "highlight pixels between the two edges = a line drawn across the map").toEqual([]);
  } finally {
    await restore();
  }
});

// แฮชของ ephem ของ E2E_ACCESS ต้อง current (ผลพร้อม) ไม่งั้น test ข้างบนจะไปคำนวณใหม่ซึ่งต้องใช้ GMAT
test("the access fixtures have current results", async ({ request }) => {
  for (const sc of [SC, "E2E_SAVE", "E2E_DATELINE"]) expect(await ephemHash(request, sc)).toMatch(/^[0-9a-f]+$/);
});
