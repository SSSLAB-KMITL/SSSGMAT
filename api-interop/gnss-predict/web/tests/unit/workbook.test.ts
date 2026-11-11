import { describe, expect, test } from "vitest";
import { nextGraphicsTitle, PANEL_KINDS } from "../../src/layout/panels";
import { WORKBOOK_MAX_BYTES, validateWorkbook, workbookBytes, type Workbook } from "../../src/layout/workbook";

/** workbook ที่ใช้ได้เล็กที่สุด (dockview เป็น object ใดก็ได้ เพราะ validate ตรวจแค่รูปร่าง ไม่ได้ให้ dockview ตรวจ) */
const valid = (): Workbook => ({
  version: 1,
  dockview: { grid: {}, panels: {} },
  panels: { objectBrowser: { kind: "objectBrowser", params: {} } },
  toolbars: { default: true, animation: true, graphics3d: false, defaults3d: false, defaults2d: false },
  timelineHidden: [],
  windowProps: {},
});

describe("nextGraphicsTitle", () => {
  test("numbers the next 3D window after the existing one", () => {
    expect(nextGraphicsTitle(["3D Graphics 1 - Earth"], "graphics3d")).toBe("3D Graphics 2 - Earth");
  });

  test("starts at 1 when there is no window of that kind", () => {
    expect(nextGraphicsTitle([], "graphics3d")).toBe("3D Graphics 1 - Earth");
    expect(nextGraphicsTitle([], "graphics2d")).toBe("2D Graphics 1 - Earth");
  });

  test("fills a gap in the numbers (1 and 3 exist -> 2)", () => {
    expect(nextGraphicsTitle(["3D Graphics 1 - Earth", "3D Graphics 3 - Earth"], "graphics3d")).toBe("3D Graphics 2 - Earth");
    expect(nextGraphicsTitle(["3D Graphics 3 - Earth"], "graphics3d")).toBe("3D Graphics 1 - Earth");
  });

  test("counts 3D and 2D separately and ignores other titles", () => {
    const existing = ["Object Browser", "3D Graphics 1 - Earth", "3D Graphics 2 - Earth", "2D Graphics 1 - Earth", "3D Graphics X - Earth", "3D Graphics 4"];
    expect(nextGraphicsTitle(existing, "graphics3d")).toBe("3D Graphics 3 - Earth");
    expect(nextGraphicsTitle(existing, "graphics2d")).toBe("2D Graphics 2 - Earth");
  });
});

describe("validateWorkbook", () => {
  test("accepts a complete workbook and returns it", () => {
    const w = validateWorkbook(valid());
    expect(w).not.toBeNull();
    expect(w).toEqual(valid());
  });

  test("a workbook survives JSON (what the server stores) unchanged", () => {
    const w = valid();
    w.timelineHidden = ["G01", "G02"];
    w.windowProps = { graphics3d: { showLabels: true } };
    expect(validateWorkbook(JSON.parse(JSON.stringify(w)))).toEqual(w);
  });

  test("anything that is not a version 1 object is null", () => {
    for (const bad of [null, undefined, "x", 5, true, [], [valid()]]) expect(validateWorkbook(bad)).toBeNull();
    for (const version of [0, 2, "1", null, undefined]) expect(validateWorkbook({ ...valid(), version })).toBeNull();
  });

  test("dockview and panels must be objects", () => {
    for (const dockview of [null, undefined, "x", 3, []]) expect(validateWorkbook({ ...valid(), dockview })).toBeNull();
    for (const panels of [null, undefined, "x", 3, []]) expect(validateWorkbook({ ...valid(), panels })).toBeNull();
  });

  test("every panel entry needs a string kind and object params", () => {
    expect(validateWorkbook({ ...valid(), panels: { a: { params: {} } } })).toBeNull();
    expect(validateWorkbook({ ...valid(), panels: { a: { kind: 3, params: {} } } })).toBeNull();
    expect(validateWorkbook({ ...valid(), panels: { a: "objectBrowser" } })).toBeNull();
    expect(validateWorkbook({ ...valid(), panels: { a: { kind: "objectBrowser", params: [] } } })).toBeNull();
    // ไม่มี params = {} (ไม่ใช่ข้อผิดพลาด)
    expect(validateWorkbook({ ...valid(), panels: { a: { kind: "objectBrowser" } } })?.panels.a).toEqual({ kind: "objectBrowser", params: {} });
  });

  test("a kind this version does not know is still a valid workbook (it is skipped later, with a warning)", () => {
    expect(validateWorkbook({ ...valid(), panels: { a: { kind: "fromTheFuture", params: {} } } })).not.toBeNull();
  });

  test("toolbars, timelineHidden and windowProps are checked when present and defaulted when missing", () => {
    const { toolbars: _t, timelineHidden: _h, windowProps: _w, ...bare } = valid();
    const w = validateWorkbook(bare);
    expect(w?.toolbars).toEqual({ default: true, animation: true, graphics3d: false, defaults3d: false, defaults2d: false });
    expect(w?.timelineHidden).toEqual([]);
    expect(w?.windowProps).toEqual({});

    expect(validateWorkbook({ ...valid(), toolbars: { ...valid().toolbars, animation: "yes" } })).toBeNull();
    expect(validateWorkbook({ ...valid(), toolbars: null })).toBeNull();
    expect(validateWorkbook({ ...valid(), timelineHidden: ["G01", 2] })).toBeNull();
    expect(validateWorkbook({ ...valid(), timelineHidden: "G01" })).toBeNull();
    expect(validateWorkbook({ ...valid(), windowProps: [] })).toBeNull();
    expect(validateWorkbook({ ...valid(), windowProps: { graphics3d: 3 } })).toBeNull();
    // ช่องแถบที่ขาดไปใช้ค่าตั้งต้น ช่องที่ไม่รู้จักทิ้ง
    expect(validateWorkbook({ ...valid(), toolbars: { default: false, extra: true } })?.toolbars)
      .toEqual({ default: false, animation: true, graphics3d: false, defaults3d: false, defaults2d: false });
  });

  test("the size limit is 1,048,576 bytes: exactly that is accepted, one more is null", () => {
    expect(WORKBOOK_MAX_BYTES).toBe(1_048_576);
    const withPad = (n: number): Workbook => ({ ...valid(), windowProps: { pad: { text: "a".repeat(n) } } });
    const base = workbookBytes(withPad(0));
    const exact = withPad(WORKBOOK_MAX_BYTES - base);
    expect(workbookBytes(exact)).toBe(WORKBOOK_MAX_BYTES);
    expect(validateWorkbook(exact)).not.toBeNull();
    const over = withPad(WORKBOOK_MAX_BYTES - base + 1);
    expect(workbookBytes(over)).toBe(WORKBOOK_MAX_BYTES + 1);
    expect(validateWorkbook(over)).toBeNull();
  });
});

describe("workbookBytes", () => {
  test("counts UTF-8 bytes of the JSON the server receives, not characters", () => {
    const w = valid();
    w.windowProps = { graphics3d: { note: "ก" } };
    const json = JSON.stringify(w);
    expect(workbookBytes(w)).toBe(new TextEncoder().encode(json).length);
    expect(workbookBytes(w)).toBeGreaterThan(json.length); // "ก" เป็น 3 ไบต์
  });
});

test("every panel kind of the contract is known", () => {
  expect([...PANEL_KINDS].sort()).toEqual([
    "about", "dailyForecastSettings", "fetchOrbitData", "graphics2d", "graphics3d", "insertObjects", "messageViewer", "newScenarioWizard",
    "objectBrowser", "propertiesBrowser", "satelliteCatalog", "stkReference", "timelineView", "viewFromTo", "welcome", "windowProperties2d",
    "windowProperties3d",
  ]);
});
