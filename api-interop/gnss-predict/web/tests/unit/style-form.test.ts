// ฟอร์มของหน้าต่างแก้ style (src/windows/ReportGraphManager/styleForm.ts): style ↔ ฟอร์มกลับไปกลับมาตรงทุกช่อง, Add / Up, แกน Y1/Y2,
// Summary, Time แบบ specify, หลาย provider รวมตาม Time, ช่องที่ engine ไม่รู้จัก และ Dynamic Display

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { parseStyle, type ProviderInfo, type StyleDef } from "../../src/data/reports";
import { msg } from "../../src/labels/messages.th";
import {
  addColumn, axisOf, canDynamic, columnsOf, formFromStyle, formProblem, moveColumn, newForm, removeColumn, setAxis, setGraphType, setSummaryOnly,
  styleFromForm, toggleStat,
} from "../../src/windows/ReportGraphManager/styleForm";

const INSTALLED = JSON.parse(readFileSync(resolve(__dirname, "../../../gnss_predict/styles/installed.json"), "utf8")) as StyleDef[];
const ENGINE_KEYS = ["name", "kind", "object_type", "content", "time", "summary", "graph", "dynamic", "derive", "ours"];

const el = (name: string, kind: "time" | "number" | "int" = "number") => ({ name, unit: null, kind, interp: "linear" as const });
const PROVIDERS: ProviderInfo[] = [
  { name: "Access Data", groups: null, uses: ["Reports"], ours: false, elements: [el("Access Number", "int"), el("Start Time", "time"), el("Stop Time", "time"), el("Duration")] },
  { name: "AER Data", groups: ["Default"], uses: ["Reports", "Dynamic Displays"], ours: false, elements: [el("Time", "time"), el("Azimuth"), el("Elevation"), el("Range")] },
  { name: "IPP Data", groups: null, uses: ["Reports", "Dynamic Displays"], ours: true, elements: [el("Time", "time"), el("IPP Lat"), el("IPP Lon"), el("MF"), el("Elevation")] },
];
const byName = (name: string, kind: "report" | "graph") => INSTALLED.find((s) => s.name === name && s.kind === kind)!;

describe("round trip", () => {
  test("round trip of every installed style", () => {
    expect(INSTALLED).toHaveLength(14);
    for (const s of INSTALLED) {
      const back = styleFromForm(formFromStyle(s));
      expect(back, `${s.name} (${s.kind})`).toStrictEqual(s);
      expect(JSON.stringify(back), `${s.name} (${s.kind}) key order`).toBe(JSON.stringify(s));
    }
  });

  test("the stack flag survives: true, false and absent", () => {
    expect(styleFromForm(formFromStyle(byName("N Asset Coverage", "graph"))).graph?.stack).toBe(true);
    expect(styleFromForm(formFromStyle(byName("AER", "graph"))).graph?.stack).toBe(false);
    const { stack: _drop, ...noStack } = byName("AER", "graph").graph!;
    const back = styleFromForm(formFromStyle({ ...byName("AER", "graph"), graph: noStack }));
    expect("stack" in back.graph!).toBe(false);
  });

  test("time mode specify keeps start, stop and step; object_period never writes start/stop", () => {
    const specify: StyleDef = { ...byName("AER", "report"), name: "AER Day", time: { mode: "specify", step_s: 60, start: "2026-11-12T06:00:00Z", stop: "2026-11-12T18:00:00Z" } };
    expect(styleFromForm(formFromStyle(specify))).toStrictEqual(specify);
    const form = formFromStyle(specify);
    const back = styleFromForm({ ...form, time: { ...form.time, mode: "object_period" } });
    expect(back.time).toStrictEqual({ mode: "object_period", step_s: 60 });
  });

  test("keys the engine does not know are not written back (check_style rejects them)", () => {
    const parsed = parseStyle({ ...byName("Access", "report"), name: "Mine", color: "red", summary: { ...byName("Access", "report").summary, extra: 1 } });
    expect(parsed.ok).toBe(true);
    const back = styleFromForm(formFromStyle(parsed.ok ? parsed.value : byName("Access", "report")));
    expect(Object.keys(back)).toEqual(ENGINE_KEYS);
    expect(Object.keys(back.summary)).toEqual(["per_object", "global_statistics", "summary_only"]);
    expect(Object.keys(back.time)).toEqual(["mode", "step_s"]);
  });

  test("a multi-provider style joined on Time round-trips", () => {
    const joined: StyleDef = {
      ...byName("AER", "report"), name: "AER IPP",
      content: [{ provider: "AER Data", group: "Default", elements: ["Time", "Elevation"] }, { provider: "IPP Data", group: null, elements: ["Time", "MF"] }],
    };
    expect(styleFromForm(formFromStyle(joined))).toStrictEqual(joined);
    expect(formProblem(formFromStyle(joined))).toBeNull();
  });
});

describe("editing", () => {
  test("new report style json", () => {
    let f = newForm("report", "Access", "My Access");
    f = addColumn(f, { provider: "Access Data", group: null, element: "Start Time" }, PROVIDERS);
    f = addColumn(f, { provider: "Access Data", group: null, element: "Duration" }, PROVIDERS);
    f = moveColumn(f, 1, -1);
    f = toggleStat(f, "Min Duration", true);
    f = toggleStat(f, "Total Duration", true);
    const s = styleFromForm(f);
    expect(s.content[0].elements).toEqual(["Duration", "Start Time"]);
    expect(s.kind).toBe("report");
    expect(s.graph).toBeNull();
    expect(s.summary.global_statistics).toEqual(["Min Duration", "Total Duration"]);
    expect(s.summary.per_object).toEqual([]);
    expect(Object.keys(s)).toEqual(ENGINE_KEYS);
  });

  test("Up at the top and Down at the bottom do nothing; moves stay within one provider", () => {
    let f = newForm("report", "Access");
    f = addColumn(f, { provider: "AER Data", group: "Default", element: "Elevation" }, PROVIDERS);
    f = addColumn(f, { provider: "IPP Data", group: null, element: "MF" }, PROVIDERS);
    // provider ที่สองได้ Time ให้ทั้งสองกลุ่ม (รวมแถวตาม Time)
    expect(columnsOf(f).map((c) => c.element)).toEqual(["Time", "Elevation", "Time", "MF"]);
    expect(moveColumn(f, 0, -1)).toBe(f);
    expect(moveColumn(f, 3, 1)).toBe(f);
    expect(moveColumn(f, 1, 1)).toBe(f); // Elevation → Time ของ IPP Data: คนละกลุ่ม
    expect(formProblem(f)).toBeNull();
    const noTime = removeColumn(f, 2);
    expect(formProblem(noTime)).toBe(msg("styleEditor.joinNeedsTime", { providers: "IPP Data" }));
  });

  test("graph style assigns y axes", () => {
    let f = newForm("graph", "Access", "AER Mine");
    for (const e of ["Time", "Elevation", "Range"]) f = addColumn(f, { provider: "AER Data", group: "Default", element: e }, PROVIDERS);
    expect(formProblem(f)).toBe(msg("styleEditor.noAxis"));
    f = setGraphType(f, "time_xy");
    f = setAxis(f, "Elevation", "y1");
    f = setAxis(f, "Range", "y2");
    expect(axisOf(f, "Range")).toBe("y2");
    expect(styleFromForm(f).graph).toStrictEqual({ type: "time_xy", y1: ["Elevation"], y2: ["Range"] });
    // ย้ายแกน และเอาออก
    f = setAxis(f, "Range", "y1");
    expect(styleFromForm(f).graph).toStrictEqual({ type: "time_xy", y1: ["Elevation", "Range"], y2: [] });
    // Remove คอลัมน์ = หายจากแกนด้วย
    f = removeColumn(f, 2);
    expect(styleFromForm(f).graph).toStrictEqual({ type: "time_xy", y1: ["Elevation"], y2: [] });
  });

  test("summary options", () => {
    let f = newForm("report", "Access", "Sum");
    f = addColumn(f, { provider: "Access Data", group: null, element: "Duration" }, PROVIDERS);
    f = toggleStat(f, "Std Deviation Duration", true);
    f = toggleStat(f, "Min Duration", true);
    f = setSummaryOnly(f, true);
    const s = styleFromForm(f);
    expect(s.summary).toStrictEqual({ per_object: ["Min Duration", "Std Deviation Duration"], global_statistics: [], summary_only: true });
    // เลิก Summary Only: กลับไปเป็น Global Statistics
    expect(styleFromForm(setSummaryOnly(f, false)).summary).toStrictEqual({ per_object: [], global_statistics: ["Min Duration", "Std Deviation Duration"], summary_only: false });
    // Remove Duration = สถิติของมันหายด้วย
    expect(styleFromForm(removeColumn(f, 0)).summary.per_object).toEqual([]);
  });
});

describe("canDynamic", () => {
  test("follows the dynamic flag of every installed style", () => {
    for (const s of INSTALLED) expect(canDynamic(s), `${s.name} (${s.kind})`).toBe(s.dynamic);
  });

  test("the editor may offer dynamic only where the engine allows it", () => {
    const on = (s: StyleDef): StyleDef => ({ ...s, dynamic: true });
    expect(canDynamic(on(byName("Access", "report")), PROVIDERS)).toBe(false); // Access Data ใช้กับ Reports เท่านั้น
    expect(canDynamic(on(byName("Gaps", "report")), PROVIDERS)).toBe(false); // derive
    expect(canDynamic(on(byName("Az El Polar", "graph")), PROVIDERS)).toBe(false); // polar90
    expect(canDynamic(on({ ...byName("AER", "report"), summary: { per_object: [], global_statistics: [], summary_only: true } }), PROVIDERS)).toBe(false);
    expect(canDynamic(on(byName("AER", "report")), PROVIDERS)).toBe(true);
    expect(canDynamic(byName("AER", "report"), PROVIDERS)).toBe(true);
    expect(canDynamic({ ...byName("AER", "report"), dynamic: false }, PROVIDERS)).toBe(false);
  });
});
