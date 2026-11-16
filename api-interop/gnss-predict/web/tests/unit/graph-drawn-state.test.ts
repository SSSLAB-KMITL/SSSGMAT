// สิ่งที่ ECharts วาดจริง (src/windows/Graph/drawnState.ts, test hook graphState().drawn): ใช้ ECharts จริงแบบ SSR (ไม่มี canvas)
// ตรวจพฤติกรรมของ ECharts ที่ options.ts พึ่ง (งาน 10 ฝากไว้ให้ตรวจกับของจริง):
// - markLine บน series ช่วย "timeLine" ที่ไม่มีจุดของตัวเองวาดเส้นได้
// - setOption แบบ merge ที่ตั้ง markLine.data เป็น [] ล้างเส้นจริง (array ไม่ถูก merge ทีละตัว)
// - จุด [t, null] ที่ทำให้เส้นขาดยังอยู่หลัง LTTB ลดจุด

import { describe, expect, test } from "vitest";
import { drawnState } from "../../src/windows/Graph/drawnState";

type ECharts = typeof import("echarts");
const load = (): Promise<ECharts> => import("echarts");

const T0 = Date.UTC(2026, 10, 10);
/** 1000 จุดทุก 30 วินาที ค่าที่ 500 เป็น null (เส้นขาด) */
const points = (): [number, number | null][] => Array.from({ length: 1000 }, (_, i) => [T0 + i * 30_000, i === 500 ? null : Math.sin(i / 40) * 90]);

function chartOf(echarts: ECharts, width: number) {
  return echarts.init(null, undefined, { renderer: "svg", ssr: true, width, height: 300 });
}

const baseOption = (sampling: "lttb" | "none", marks: number[]) => ({
  animation: false,
  xAxis: { id: "time", type: "time" },
  yAxis: { type: "value" },
  series: [
    { id: "a", name: "THBK-To-G01 Azimuth", type: "line", data: points(), sampling, showSymbol: false, connectNulls: false },
    { id: "timeLine", type: "line", data: [], silent: true, markLine: { silent: true, symbol: ["none", "none"], data: marks.map((x) => ({ xAxis: x })) } },
  ],
});

describe("drawnState", () => {
  test("a narrow chart samples the line with LTTB and keeps the null break; a wide one draws every point", async () => {
    const echarts = await load();
    const narrow = chartOf(echarts, 240);
    narrow.setOption(baseOption("lttb", []));
    const line = drawnState(narrow).series.find((s) => s.id === "a")!;
    expect(line.input).toBe(1000);
    expect(line.inputBreaks).toBe(1);
    expect(line.drawn).toBeLessThan(1000);
    expect(line.breaks).toBeGreaterThanOrEqual(1);
    narrow.dispose();

    const wide = chartOf(echarts, 1600);
    wide.setOption(baseOption("lttb", []));
    const all = drawnState(wide).series.find((s) => s.id === "a")!;
    expect([all.drawn, all.breaks]).toEqual([1000, 1]);
    wide.dispose();
  });

  test("the time line helper draws its markLine, and a merge with data [] clears it", async () => {
    const echarts = await load();
    const chart = chartOf(echarts, 800);
    chart.setOption(baseOption("none", [T0 + 3_600_000]));
    expect(drawnState(chart).timeLineMarks).toBe(1);
    chart.setOption({ series: [{ id: "timeLine", markLine: { data: [] } }] });
    expect(drawnState(chart).timeLineMarks).toBe(0);
    chart.setOption({ series: [{ id: "timeLine", markLine: { data: [{ xAxis: T0 + 7_200_000 }] } }] });
    expect(drawnState(chart).timeLineMarks).toBe(1);
    chart.dispose();
  });

  test("a disposed or foreign chart gives an empty state instead of throwing", async () => {
    const echarts = await load();
    const chart = chartOf(echarts, 400);
    chart.dispose();
    expect(drawnState(chart)).toEqual({ series: [], timeLineMarks: 0 });
    expect(drawnState({} as never)).toEqual({ series: [], timeLineMarks: 0 });
  });
});
