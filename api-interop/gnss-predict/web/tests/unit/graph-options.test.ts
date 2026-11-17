// ตัวสร้าง option ของหน้าต่างกราฟ (src/windows/Graph/options.ts): ฟังก์ชันล้วน ไม่ import echarts (jsdom วาด ECharts ไม่ได้)
// ตรวจข้อมูลของ series แกน การแปลงพิกัด polar ช่องว่างเป็น null (เส้นขาด) การซ้อน เส้นเวลา animation และ Strip Chart

import { describe, expect, test } from "vitest";
import { valueAt } from "../../src/data/dynamic";
import type { ReportJson, ReportSection } from "../../src/data/reports";
import { formatTime } from "../../src/time/format";
import {
  colorKeyOf, DEFAULT_GRAPH_THEME, graphCrosshairOption, graphOption, graphState, graphTimeOption, objectColorOf, STRIP_CHART_DURATION_S, timeAxisLabel,
  type GraphCtx,
} from "../../src/windows/Graph/options";
import { makeDoc } from "./helpers/chrome";

const T0 = Date.UTC(2026, 10, 12);
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const G01 = "*/Facility/THBK */Satellite/G01";
const E11 = "*/Facility/THBK */Satellite/E11";
const COLORS: Record<string, string> = { [G01]: "#ffd23f", [E11]: "#4fd47e", "*/Facility/THBK": "#ff79e6" };

const ctx = (over: Partial<GraphCtx> = {}): GraphCtx => ({
  dateFormat: "UTCG", ltz: "+07:00", colorOf: (o) => COLORS[o] ?? "#c8c8c8", now: null, showTimeLine: true, stripMs: null, maxGapMs: 90_000, ...over,
});

const AER_COLUMNS = [
  { name: "Time", unit: null, kind: "time" as const },
  { name: "Azimuth", unit: "deg", kind: "number" as const },
  { name: "Elevation", unit: "deg", kind: "number" as const },
  { name: "Range", unit: "km", kind: "number" as const },
];

function section(object: string, title: string, columns: ReportSection["columns"], rows: ReportSection["rows"]): ReportSection {
  return { object, title, columns, rows, summary: [], summary_only: false };
}

/** แถว AER ทุก 1 นาที เริ่ม T0 + startMin: [Az, El, Range] */
const aerRows = (startMin: number, values: [number, number, number][]) =>
  values.map(([az, el, rg], i) => [iso(T0 + (startMin + i) * MIN), az, el, rg]);

function report(graph: ReportJson["graph"], sections: ReportSection[], dynamic = false): ReportJson {
  return { scenario: "S1", style: "X", kind: "graph", created_utc: iso(T0), graph, dynamic, sections, global_statistics: [] };
}

const AER_GRAPH = { type: "time_xy" as const, y1: ["Azimuth", "Elevation"], y2: ["Range"], stack: false };
const aer = (sections: ReportSection[], dynamic = false) => report(AER_GRAPH, sections, dynamic);
const g01 = (rows = aerRows(0, [[100, 10, 22000], [110, 20, 21500], [120, 30, 21000]])) => section(G01, "THBK-To-G01", AER_COLUMNS, rows);

type AnyObj = Record<string, any>;
const seriesOf = (o: AnyObj): AnyObj[] => o.series as AnyObj[];
const dataSeries = (o: AnyObj) => seriesOf(o).filter((s) => s.id !== "timeLine" && s.id !== "current");
const timeLineSeries = (o: AnyObj) => seriesOf(o).find((s) => s.id === "timeLine");
const markLineAt = (o: AnyObj): number[] => (timeLineSeries(o)?.markLine?.data ?? []).map((d: AnyObj) => d.xAxis);
const xAxis = (o: AnyObj) => (Array.isArray(o.xAxis) ? o.xAxis[0] : o.xAxis);

describe("time_xy", () => {
  test("time_xy puts y2 on the right axis", () => {
    const o = graphOption(aer([g01()]), ctx()) as AnyObj;
    const series = dataSeries(o);
    expect(series.map((s) => [s.name, s.yAxisIndex])).toEqual([
      ["THBK-To-G01 Azimuth", 0], ["THBK-To-G01 Elevation", 0], ["THBK-To-G01 Range", 1],
    ]);
    for (const s of series) {
      expect(s.type).toBe("line");
      expect(s.sampling).toBe("lttb");
    }
    expect(o.yAxis).toHaveLength(2);
    expect(o.yAxis[1].position).toBe("right");
    expect(o.yAxis[0].name).toBe("deg");
    expect(o.yAxis[1].name).toBe("km");
    expect(xAxis(o).type).toBe("time");
    // ข้อมูลเป็น [ms, ค่า] ตามลำดับเวลา
    expect(series[1].data).toEqual([[T0, 10], [T0 + MIN, 20], [T0 + 2 * MIN, 30]]);
  });

  test("a graph without y2 has one value axis", () => {
    const o = graphOption(report({ type: "time_xy", y1: ["Elevation"], y2: [], stack: false }, [g01()]), ctx()) as AnyObj;
    expect(o.yAxis).toHaveLength(1);
    expect(dataSeries(o).map((s) => s.name)).toEqual(["THBK-To-G01 Elevation"]);
  });

  test("azimuth line breaks at the wrap", () => {
    const rows = aerRows(0, [[358, 10, 1], [359.5, 11, 1], [0.5, 12, 1], [2, 13, 1]]);
    const o = graphOption(aer([g01(rows)]), ctx()) as AnyObj;
    const az = dataSeries(o).find((s) => s.name === "THBK-To-G01 Azimuth")!;
    expect(az.data.map((d: unknown[]) => d[1])).toEqual([358, 359.5, null, 0.5, 2]);
    // จุดคั่นอยู่ระหว่างสองจุดนั้น (ไม่ทำให้ลำดับเวลาเพี้ยน)
    const brk = az.data[2] as [number, null];
    expect(brk[0]).toBeGreaterThan(T0 + MIN);
    expect(brk[0]).toBeLessThan(T0 + 2 * MIN);
    // Elevation ไม่ขาด (ไม่ใช่มุมที่วน)
    const el = dataSeries(o).find((s) => s.name === "THBK-To-G01 Elevation")!;
    expect(el.data.map((d: unknown[]) => d[1])).toEqual([10, 11, 12, 13]);
  });

  test("the line breaks between accesses (gap longer than max gap) and at missing values", () => {
    const rows = [...aerRows(0, [[100, 10, 1], [101, 11, 1]]), ...aerRows(30, [[200, 12, 1], [201, 13, 1]])];
    (rows[3] as (string | number | null)[])[2] = null; // ค่าที่ไม่มี = เส้นขาด
    const o = graphOption(aer([g01(rows)]), ctx({ maxGapMs: 90_000 })) as AnyObj;
    const el = dataSeries(o).find((s) => s.name === "THBK-To-G01 Elevation")!;
    expect(el.data.map((d: unknown[]) => d[1])).toEqual([10, 11, null, 12, null]);
    for (const s of dataSeries(o)) expect(s.connectNulls).toBe(false);
  });

  test("without maxGapMs the gap rule falls back to 1.5 x the shortest step of the data", () => {
    const rows = [...aerRows(0, [[100, 10, 1], [101, 11, 1], [102, 12, 1]]), ...aerRows(10, [[103, 13, 1]])];
    const o = graphOption(aer([g01(rows)]), ctx({ maxGapMs: undefined })) as AnyObj;
    const el = dataSeries(o).find((s) => s.name === "THBK-To-G01 Elevation")!;
    expect(el.data.map((d: unknown[]) => d[1])).toEqual([10, 11, 12, null, 13]);
  });

  test("series per object use the object color", () => {
    const e11 = section(E11, "THBK-To-E11", AER_COLUMNS, aerRows(5, [[10, 5, 25000], [20, 6, 25100]]));
    const o = graphOption(aer([g01(), e11]), ctx()) as AnyObj;
    const series = dataSeries(o);
    expect(series).toHaveLength(6);
    for (const s of series.slice(0, 3)) {
      expect(s.name.startsWith("THBK-To-G01")).toBe(true);
      expect(s.color).toBe("#ffd23f");
    }
    for (const s of series.slice(3)) {
      expect(s.name.startsWith("THBK-To-E11")).toBe(true);
      expect(s.color).toBe("#4fd47e");
    }
    // element ต่างกันของ object เดียวกันแยกด้วยรูปเส้น
    expect(new Set(series.slice(0, 3).map((s) => JSON.stringify(s.lineStyle.type))).size).toBe(3);
    expect(o.legend.data).toEqual(series.map((s) => s.name));
  });

  test("gap breaks come from the times only, so every series of a section stays index-aligned", () => {
    // Elevation ไม่มีค่าที่แถวก่อนช่องว่างพอดี: จุดคั่นของช่องว่างยังอยู่ที่ตำแหน่งเดียวกับของ Range
    const rows = [...aerRows(0, [[100, 10, 1], [101, 11, 2]]), ...aerRows(30, [[102, 12, 3], [103, 13, 4]])];
    (rows[1] as (string | number | null)[])[2] = null;
    const o = graphOption(aer([g01(rows)]), ctx({ maxGapMs: 90_000 })) as AnyObj;
    const el = dataSeries(o).find((s) => s.name === "THBK-To-G01 Elevation")!;
    const rg = dataSeries(o).find((s) => s.name === "THBK-To-G01 Range")!;
    expect(el.data.map((d: unknown[]) => d[1])).toEqual([10, null, null, 12, 13]);
    expect(rg.data.map((d: unknown[]) => d[1])).toEqual([1, 2, null, 3, 4]);
    expect(el.data.map((d: unknown[]) => d[0])).toEqual(rg.data.map((d: unknown[]) => d[0]));
  });

  test("stacked and step series are not sampled (lttb would misalign the bands)", () => {
    const columns = [
      { name: "Time", unit: null, kind: "time" as const },
      { name: "GDOP", unit: null, kind: "number" as const },
      { name: "N Visible", unit: null, kind: "int" as const },
      { name: "GPS", unit: null, kind: "int" as const },
    ];
    const rows = [[iso(T0), 1.5, 9, 9], [iso(T0 + MIN), 1.6, 10, 10]];
    const fac = section("*/Facility/THBK", "THBK", columns, rows);
    const stacked = dataSeries(graphOption(report({ type: "time_xy", y1: ["GPS"], y2: [], stack: true }, [fac]), ctx()) as AnyObj);
    expect(stacked.map((s) => s.sampling)).toEqual(["none"]);
    const mixed = dataSeries(graphOption(report({ type: "time_xy", y1: ["GDOP"], y2: ["N Visible"], stack: false }, [fac]), ctx()) as AnyObj);
    expect(mixed.map((s) => [s.name, s.sampling, s.step])).toEqual([["THBK GDOP", "lttb", undefined], ["THBK N Visible", "none", "end"]]);
  });

  test("the crosshair part only touches the axis pointers (merge, keeps the zoom)", () => {
    expect(graphCrosshairOption(aer([g01()]), ctx({ crosshair: true }))).toEqual({ tooltip: { axisPointer: { type: "cross" } } });
    expect(graphCrosshairOption(aer([g01()]), ctx())).toEqual({ tooltip: { axisPointer: { type: "line" } } });
    expect(graphCrosshairOption({ ...aer([g01()]), graph: null }, ctx())).toBeNull();
  });

  test("stacked n asset coverage", () => {
    const columns = [
      { name: "Time", unit: null, kind: "time" as const },
      ...["Total", "GPS", "GLONASS", "Galileo", "BeiDou"].map((name) => ({ name, unit: null, kind: "int" as const })),
    ];
    const rows = [[iso(T0), 30, 10, 8, 7, 5], [iso(T0 + MIN), 31, 11, 8, 7, 5]];
    const r = report({ type: "time_xy", y1: ["GPS", "GLONASS", "Galileo", "BeiDou"], y2: [], stack: true }, [section("*/Facility/THBK", "THBK", columns, rows)]);
    const o = graphOption(r, ctx()) as AnyObj;
    const series = dataSeries(o);
    expect(series.map((s) => s.name)).toEqual(["THBK GPS", "THBK GLONASS", "THBK Galileo", "THBK BeiDou"]);
    for (const s of series) {
      expect(s.stack).toBe("total");
      expect(s.step).toBe("end");
      expect(s.areaStyle).toBeTruthy();
    }
    // สีของระบบ (theme token) ไม่ใช่สีเดียวของ Facility
    expect(series.map((s) => s.color)).toEqual([
      DEFAULT_GRAPH_THEME.systems.gps, DEFAULT_GRAPH_THEME.systems.glonass, DEFAULT_GRAPH_THEME.systems.galileo, DEFAULT_GRAPH_THEME.systems.beidou,
    ]);
    expect(o.yAxis[0].minInterval).toBe(1);
  });

  test("axis labels use DateFormat", () => {
    const o = graphOption(aer([g01()]), ctx()) as AnyObj;
    const formatter = xAxis(o).axisLabel.formatter as (v: number) => string;
    const text = formatter(T0 + 90 * MIN);
    expect(text.endsWith(" UTCG")).toBe(true);
    expect(text).toContain("12 Nov 2026");
    expect(text).toContain("01:30:00");
    const local = graphOption(aer([g01()]), ctx({ dateFormat: "LTZG" })) as AnyObj;
    expect((xAxis(local).axisLabel.formatter as (v: number) => string)(T0 + 90 * MIN).endsWith(" LTZG+07:00")).toBe(true);
    expect(timeAxisLabel(T0, "UTCG", "+07:00")).toBe("12 Nov 2026\n00:00:00 UTCG");
  });

  test("the x axis spans the data by default", () => {
    const o = graphOption(aer([g01()]), ctx()) as AnyObj;
    expect(xAxis(o).min).toBe(T0);
    expect(xAxis(o).max).toBe(T0 + 2 * MIN);
  });

  test("the theme comes from tokens", () => {
    const theme = { ...DEFAULT_GRAPH_THEME, bg: "#101010", text: "#eeeeee" };
    const o = graphOption(aer([g01()]), ctx({ theme })) as AnyObj;
    expect(o.backgroundColor).toBe("#101010");
    expect(o.textStyle.color).toBe("#eeeeee");
  });

  test("crosshair cursor sets the axis pointer", () => {
    expect((graphOption(aer([g01()]), ctx()) as AnyObj).tooltip.axisPointer.type).toBe("line");
    expect((graphOption(aer([g01()]), ctx({ crosshair: true })) as AnyObj).tooltip.axisPointer.type).toBe("cross");
  });

  test("the tooltip shows the time in DateFormat", () => {
    const o = graphOption(aer([g01()]), ctx()) as AnyObj;
    const text = o.tooltip.formatter([{ seriesName: "THBK-To-G01 Elevation", value: [T0 + MIN, 20], color: "#ffd23f" }]) as string;
    expect(text).toContain(formatTime(new Date(T0 + MIN), "UTCG", "+07:00"));
    expect(text).toContain("THBK-To-G01 Elevation");
    expect(text).toContain("20.000");
  });
});

describe("interval", () => {
  const ACCESS_COLUMNS = [
    { name: "Start Time", unit: null, kind: "time" as const },
    { name: "Stop Time", unit: null, kind: "time" as const },
  ];
  const intervals = () => report({ type: "interval", y1: [], y2: [], stack: false }, [
    section(G01, "THBK-To-G01", ACCESS_COLUMNS, [[iso(T0 + 60 * MIN), iso(T0 + 120 * MIN)], [iso(T0 + 300 * MIN), iso(T0 + 330 * MIN)]]),
    section(E11, "THBK-To-E11", ACCESS_COLUMNS, [[iso(T0 + 200 * MIN), iso(T0 + 260 * MIN)]]),
  ]);

  test("interval graph draws one band per access", () => {
    const o = graphOption(intervals(), ctx()) as AnyObj;
    const bands = seriesOf(o).filter((s) => s.type === "custom");
    expect(bands).toHaveLength(1);
    expect(bands[0].data).toEqual([
      [0, T0 + 60 * MIN, T0 + 120 * MIN], [0, T0 + 300 * MIN, T0 + 330 * MIN], [1, T0 + 200 * MIN, T0 + 260 * MIN],
    ]);
    expect(o.yAxis.type).toBe("category");
    expect(o.yAxis.data).toEqual(["THBK-To-G01", "THBK-To-E11"]);
    expect(xAxis(o).min).toBe(T0 + 60 * MIN);
    expect(xAxis(o).max).toBe(T0 + 330 * MIN);
  });

  test("bands are drawn in the object color and clipped to the plot", () => {
    const o = graphOption(intervals(), ctx()) as AnyObj;
    const band = seriesOf(o).find((s) => s.type === "custom")!;
    const api = {
      value: (i: number) => [1, T0 + 200 * MIN, T0 + 260 * MIN][i],
      coord: ([x, y]: [number, number]) => [(x - T0) / MIN, y * 40 + 20],
      size: () => [0, 40],
    };
    const shape = band.renderItem({ coordSys: { x: 0, y: 0, width: 230, height: 100 } }, api);
    expect(shape.type).toBe("rect");
    expect(shape.style.fill).toBe("#4fd47e");
    expect(shape.shape.x).toBe(200);
    expect(shape.shape.width).toBe(30); // ตัดที่ขอบขวาของพื้นที่กราฟ (230)
    expect(band.renderItem({ coordSys: { x: 0, y: 0, width: 100, height: 100 } }, api)).toBeNull();
  });

  test("the crosshair part of interval graphs shows the axis pointers by id", () => {
    const o = graphOption(intervals(), ctx()) as AnyObj;
    expect(xAxis(o).id).toBe("time");
    expect(o.yAxis.id).toBe("objects");
    expect(graphCrosshairOption(intervals(), ctx({ crosshair: true }))).toEqual({
      tooltip: { axisPointer: { type: "cross" } },
      xAxis: { id: "time", axisPointer: { show: true } },
      yAxis: { id: "objects", axisPointer: { show: true } },
    });
  });

  test("the time line is a vertical line in interval graphs too", () => {
    const o = graphOption(intervals(), ctx({ now: T0 + 100 * MIN })) as AnyObj;
    expect(markLineAt(o)).toEqual([T0 + 100 * MIN]);
    expect(graphState(intervals(), ctx({ now: T0 + 100 * MIN }))).toEqual({
      type: "interval", series: ["THBK-To-G01", "THBK-To-E11"], timeLine: T0 + 100 * MIN, currentPoint: null,
    });
  });
});

describe("polar90", () => {
  const POLAR_COLUMNS = AER_COLUMNS.slice(0, 3);
  const polar = (rows = aerRows(0, [[350, 10, 0], [0, 20, 0], [10, 30, 0]]).map((r) => r.slice(0, 3))) =>
    report({ type: "polar90", y1: [], y2: [], stack: false }, [section(G01, "THBK-To-G01", POLAR_COLUMNS, rows)]);

  test("polar90 maps elevation to radius", () => {
    const o = graphOption(polar(), ctx()) as AnyObj;
    expect(o.radiusAxis).toMatchObject({ min: 0, max: 90, inverse: true });
    expect(o.angleAxis).toMatchObject({ startAngle: 90, clockwise: true, min: 0, max: 360 });
    const points = dataSeries(o);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ type: "scatter", coordinateSystem: "polar", large: true, name: "THBK-To-G01", color: "#ffd23f" });
    expect(points[0].data).toEqual([[10, 350], [20, 0], [30, 10]]);
  });

  test("time line and current point", () => {
    const now = T0 + MIN / 2; // กลางระหว่าง Az 350 กับ 0 (ข้ามทิศเหนือ)
    const r = polar();
    const o = graphOption(r, ctx({ now })) as AnyObj;
    const current = seriesOf(o).find((s) => s.id === "current")!;
    const section0 = r.sections[0];
    const expected = valueAt(section0.rows, section0.rows.map((row) => Date.parse(row[0] as string)), now, ["none", "angle", "linear"], 90_000)!;
    expect(current.data).toHaveLength(1);
    expect(current.data[0].value[0]).toBeCloseTo(expected[2]!, 9);
    expect(current.data[0].value[1]).toBeCloseTo(expected[1]!, 9);
    expect(current.data[0].value[1]).toBeCloseTo(355, 9);
    expect(current.data[0].value[0]).toBeCloseTo(15, 9);
    expect(graphState(r, ctx({ now }))).toMatchObject({ type: "polar90", series: ["THBK-To-G01"], timeLine: null });
    expect(graphState(r, ctx({ now }))!.currentPoint![1]).toBeCloseTo(355, 9);
    // polar ไม่มีเส้นแนวตั้ง
    expect(markLineAt(o)).toEqual([]);

    // เวลานอก access = ไม่มีจุด
    const outside = graphOption(r, ctx({ now: T0 + 60 * MIN })) as AnyObj;
    expect(seriesOf(outside).find((s) => s.id === "current")!.data).toEqual([]);
    expect(graphState(r, ctx({ now: T0 + 60 * MIN }))!.currentPoint).toBeNull();
    // ปิดเส้นเวลา = ไม่มีจุด
    expect(seriesOf(graphOption(r, ctx({ now, showTimeLine: false })) as AnyObj).find((s) => s.id === "current")!.data).toEqual([]);
  });
});

describe("time line and strip chart", () => {
  test("time line and current point", () => {
    const now = T0 + MIN / 2;
    expect(markLineAt(graphOption(aer([g01()]), ctx({ now })) as AnyObj)).toEqual([now]);
    expect(markLineAt(graphOption(aer([g01()]), ctx({ now, showTimeLine: false })) as AnyObj)).toEqual([]);
    expect(markLineAt(graphOption(aer([g01()]), ctx({ now: null })) as AnyObj)).toEqual([]);
    // เวลานอกช่วงของแกนไม่วาดเส้น (ไม่ให้ขยายแกน)
    expect(markLineAt(graphOption(aer([g01()]), ctx({ now: T0 + 60 * MIN })) as AnyObj)).toEqual([]);
    expect(graphState(aer([g01()]), ctx({ now }))).toEqual({
      type: "time_xy", series: ["THBK-To-G01 Azimuth", "THBK-To-G01 Elevation", "THBK-To-G01 Range"], timeLine: now, currentPoint: null,
    });
    expect(graphState(aer([g01()]), ctx({ now, showTimeLine: false }))!.timeLine).toBeNull();
  });

  test("strip chart window", () => {
    expect(STRIP_CHART_DURATION_S).toBe(3600);
    const now = T0 + 2 * 3_600_000;
    const o = graphOption(aer([g01()], true), ctx({ now, stripMs: 3_600_000 })) as AnyObj;
    expect(xAxis(o).min).toBe(now - 3_600_000);
    expect(xAxis(o).max).toBe(now);
    // เส้นเวลาอยู่ที่ขอบขวา
    expect(markLineAt(o)).toEqual([now]);
  });

  test("the time option only carries what follows the clock, with the same ids", () => {
    const now = T0 + MIN;
    const part = graphTimeOption(aer([g01()], true), ctx({ now, stripMs: 3_600_000 })) as AnyObj;
    expect(Object.keys(part).sort()).toEqual(["series", "xAxis"]);
    expect(xAxis(part)).toMatchObject({ id: "time", min: now - 3_600_000, max: now });
    expect(part.series.map((s: AnyObj) => s.id)).toEqual(["timeLine"]);
    const full = graphOption(aer([g01()], true), ctx({ now, stripMs: 3_600_000 })) as AnyObj;
    expect(xAxis(full).id).toBe("time");
    expect(timeLineSeries(full)!.markLine.data).toEqual(part.series[0].markLine.data);

    const polarPart = graphTimeOption(
      report({ type: "polar90", y1: [], y2: [], stack: false }, [section(G01, "THBK-To-G01", AER_COLUMNS.slice(0, 3), aerRows(0, [[1, 10, 0], [2, 20, 0]]).map((r) => r.slice(0, 3)))]),
      ctx({ now: T0 + MIN / 2 }),
    ) as AnyObj;
    expect(Object.keys(polarPart)).toEqual(["series"]);
    expect(polarPart.series[0].id).toBe("current");
    expect(polarPart.series[0].data).toHaveLength(1);
  });
});

describe("graph without a definition or data", () => {
  test("a report without graph gives null option and state", () => {
    const r = { ...aer([g01()]), graph: null };
    expect(graphOption(r, ctx())).toBeNull();
    expect(graphState(r, ctx())).toBeNull();
  });

  test("a section with no rows draws no series but keeps the axes", () => {
    const o = graphOption(aer([g01([])]), ctx({ now: T0 })) as AnyObj;
    expect(dataSeries(o).every((s) => s.data.length === 0)).toBe(true);
    expect(markLineAt(o)).toEqual([]);
    expect(o.yAxis).toHaveLength(2);
  });
});

describe("object colours", () => {
  test("access pairs take the satellite colour, facilities and satellites their own", () => {
    const doc = makeDoc({
      objects: [
        { class: "Facility", name: "THBK", position: { type: "Geodetic", lat_deg: 13.7, lon_deg: 100.5, alt_m: 0 } },
        { class: "Satellite", name: "G01", norad: 1 },
        { class: "Satellite", name: "E11", norad: 2, graphics2d: { inherit: false, color: "#123456" } },
      ] as never,
    });
    const tokens = { gps: "#ffd23f", glonass: "#ff6b6b", galileo: "#4fd47e", beidou: "#45c8ff", other: "#c8c8c8", facility: "#ff79e6", access: "#9dff6b" };
    const colorOf = objectColorOf(doc, new Map([[1, "G01"]]), tokens);
    expect(colorOf(G01)).toBe("#ffd23f");
    expect(colorOf(E11)).toBe("#123456");
    expect(colorOf("*/Facility/THBK")).toBe("#ff79e6");
    expect(colorOf("*/Satellite/G01")).toBe("#ffd23f");
    expect(colorOf("*/Satellite/NOPE")).toBe("#c8c8c8");
    expect(objectColorOf(null, new Map(), tokens)(G01)).toBe("#c8c8c8");
  });

  test("the colour key changes only with what the colours depend on", () => {
    const base = makeDoc({
      objects: [
        { class: "Facility", name: "THBK", position: { type: "Geodetic", lat_deg: 13.7, lon_deg: 100.5, alt_m: 0 } },
        { class: "Satellite", name: "G01", norad: 1 },
        { class: "Constellation", name: "GPS", system: "G", assigned_objects: ["*/Satellite/G01"] },
      ] as never,
    });
    const prn = new Map([[1, "G01"]]);
    const key = colorKeyOf(base, prn);
    // แก้คำอธิบาย ตำแหน่ง Facility หรือช่วงเวลา: สีไม่เปลี่ยน
    expect(colorKeyOf({ ...base, description: "x", analysis_period: { start: "2026-11-13T00:00:00Z", stop: "2026-11-14T00:00:00Z" } }, prn)).toBe(key);
    const moved = { ...base, objects: base.objects.map((o) => (o.class === "Facility" ? { ...o, position: { type: "Geodetic", lat_deg: 1, lon_deg: 2, alt_m: 0 } } : o)) } as typeof base;
    expect(colorKeyOf(moved, new Map(prn))).toBe(key);
    // สีของดาว สีของ Constellation สมาชิก หรือ PRN เปลี่ยน: กุญแจเปลี่ยน
    const recolored = { ...base, objects: base.objects.map((o) => (o.name === "G01" ? { ...o, graphics2d: { inherit: false, color: "#123456" } } : o)) } as typeof base;
    expect(colorKeyOf(recolored, prn)).not.toBe(key);
    const constColor = { ...base, objects: base.objects.map((o) => (o.class === "Constellation" ? { ...o, color: "#abcdef" } : o)) } as typeof base;
    expect(colorKeyOf(constColor, prn)).not.toBe(key);
    expect(colorKeyOf(base, new Map([[1, "R01"]]))).not.toBe(key);
    expect(colorKeyOf(null, prn)).not.toBe(key);
  });
});
