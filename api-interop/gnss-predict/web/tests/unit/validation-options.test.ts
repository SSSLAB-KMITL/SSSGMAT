// option ของ ECharts ในหน้า Validation (src/windows/Validation/options.ts): ฟังก์ชันล้วน ไม่ import echarts
// กราฟแนวโน้ม: เส้น P99 ต่อระบบตามวัน + เส้นเกณฑ์ (markLine) 0.2° / 0.5°; กราฟอายุกับความคลาด: จุดต่อดวง แยกสีตามระบบ

import { describe, expect, test } from "vitest";
import { DEFAULT_GRAPH_THEME } from "../../src/windows/Graph/options";
import { ageOption, trendOption } from "../../src/windows/Validation/options";
import { trendSeries, type HistoryRecord } from "../../src/windows/Validation/rows";

type AnyObj = Record<string, any>;

const stats = (el_p99: number, az_p99: number) => ({ sats: 30, pairs: 100, az_pairs: 90, el_median: 0.01, el_p99, az_median: 0.01, az_p99, pass: true });
const REC = (day: string, g: number, e: number): HistoryRecord => ({
  day, scenario: "E2E", pass: true, failing: [], created_utc: `${day}T03:00:00Z`, systems: { G: stats(g, g * 2), E: stats(e, e * 2) },
});
const HISTORY = [REC("2026-11-09", 0.11, 0.12), REC("2026-11-10", 0.31, 0.13)];
const NAME: Record<string, string> = { G: "GPS", E: "Galileo" };
const ctx = { theme: DEFAULT_GRAPH_THEME, systemName: (s: string) => NAME[s] ?? s };

const limitLine = (o: AnyObj): AnyObj => (o.series as AnyObj[]).find((s) => s.id === "limit")!.markLine;

describe("trend option", () => {
  test("a line per system on the days axis, in the colour of the system", () => {
    const o = trendOption(trendSeries(HISTORY, "el"), ctx) as AnyObj;
    expect(o.xAxis.data).toEqual(["2026-11-09", "2026-11-10"]);
    const lines = (o.series as AnyObj[]).filter((s) => s.type === "line" && s.id !== "limit");
    expect(lines.map((s) => [s.name, s.data, s.color])).toEqual([
      ["GPS", [0.11, 0.31], DEFAULT_GRAPH_THEME.systems.gps],
      ["Galileo", [0.12, 0.13], DEFAULT_GRAPH_THEME.systems.galileo],
    ]);
    expect(o.legend.data).toEqual(["GPS", "Galileo"]);
    expect(o.animation).toBe(false);
  });

  test("trend thresholds: the limit line is at 0.2 for el and 0.5 for az", () => {
    expect(limitLine(trendOption(trendSeries(HISTORY, "el"), ctx) as AnyObj).data).toEqual([expect.objectContaining({ yAxis: 0.2 })]);
    expect(limitLine(trendOption(trendSeries(HISTORY, "az"), ctx) as AnyObj).data).toEqual([expect.objectContaining({ yAxis: 0.5 })]);
  });

  test("the axis always reaches the limit (ECharts does not count a markLine), and never cuts a value above it", () => {
    const o = trendOption(trendSeries([REC("2026-11-09", 0.01, 0.02)], "el"), ctx) as AnyObj;
    expect(o.yAxis.min).toBe(0);
    // ค่าทุกตัวต่ำกว่าเกณฑ์มาก: แกนยังสูงถึงเส้นเกณฑ์ (+ ที่ว่าง); ค่าเกินเกณฑ์: แกนสูงกว่าค่านั้น; ปัดขึ้นทีละ 0.05 ให้ป้ายแกนกลม
    expect(o.yAxis.max({ min: 0, max: 0.02 })).toBe(0.25);
    expect(o.yAxis.max({ min: 0, max: 0.9 })).toBe(1);
    expect(o.yAxis.max({ min: 0, max: 0.31 })).toBeCloseTo(0.35, 10);
    expect(limitLine(o).silent).toBe(true);
  });

  test("a system with no value on a day leaves a gap (null), not zero", () => {
    const only: HistoryRecord = { ...REC("2026-11-08", 0.1, 0.1), systems: { G: stats(0.1, 0.2) } };
    const o = trendOption(trendSeries([only, REC("2026-11-09", 0.11, 0.12)], "el"), ctx) as AnyObj;
    expect((o.series as AnyObj[]).find((s) => s.name === "Galileo")!.data).toEqual([null, 0.12]);
  });

  test("no history still draws the axis and the limit line", () => {
    const o = trendOption(trendSeries([], "el"), ctx) as AnyObj;
    expect(o.xAxis.data).toEqual([]);
    expect(limitLine(o).data).toEqual([expect.objectContaining({ yAxis: 0.2 })]);
  });
});

describe("age option", () => {
  const POINTS: [number, number, string][] = [[0.5, 0.011, "G01"], [3.25, 0.02, "E05"], [1.5, 0.052, "G22"], [6.5, 0.31, "J01"]];

  test("one scatter series per system, large mode, points are [age, 3D median]", () => {
    const o = ageOption(POINTS, ctx) as AnyObj;
    const series = o.series as AnyObj[];
    expect(series.every((s) => s.type === "scatter" && s.large === true)).toBe(true);
    expect(series.map((s) => [s.name, s.color, s.data.map((d: unknown[]) => d.slice(0, 2))])).toEqual([
      ["GPS", DEFAULT_GRAPH_THEME.systems.gps, [[0.5, 0.011], [1.5, 0.052]]],
      ["Galileo", DEFAULT_GRAPH_THEME.systems.galileo, [[3.25, 0.02]]],
      ["J", expect.any(String), [[6.5, 0.31]]],
    ]);
    // PRN อยู่ท้ายของแต่ละจุด ไว้แสดงใน tooltip
    expect(series[0].data[0]).toEqual([0.5, 0.011, "G01"]);
  });

  test("the tooltip names the satellite and escapes it", () => {
    const o = ageOption([[1, 0.1, "<b>G01</b>"]], ctx) as AnyObj;
    const html = o.tooltip.formatter({ data: [1, 0.1, "<b>G01</b>"], seriesName: "GPS" }) as string;
    expect(html).toContain("&lt;b&gt;G01&lt;/b&gt;");
    expect(html).not.toContain("<b>");
  });

  test("axes are the age in days and the 3D median in km", () => {
    const o = ageOption(POINTS, ctx) as AnyObj;
    expect(o.xAxis.type).toBe("value");
    expect(o.yAxis.type).toBe("value");
    expect(o.xAxis.min).toBe(0);
    expect(o.yAxis.min).toBe(0);
  });

  test("no points: an empty chart", () => {
    expect((ageOption([], ctx) as AnyObj).series).toEqual([]);
  });
});
