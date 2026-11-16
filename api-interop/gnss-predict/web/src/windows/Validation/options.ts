// option ของ ECharts สองกราฟในหน้า Validation (spec §7): ฟังก์ชันล้วน ไม่ import echarts (โหลดผ่าน windows/Graph/chart.ts เท่านั้น)
//
// - แนวโน้ม (trendOption): เส้น P99 ต่อระบบตามวัน (แกนวันแบบหมวด) กับเส้นเกณฑ์แนวนอน (markLine ของ series "limit") 0.2° สำหรับ ΔEl / 0.5° สำหรับ ΔAz
//   ECharts ไม่นับ markLine เข้าช่วงแกน: แกน Y จึงกำหนดเพดานเอง (สูงกว่าทั้งค่าสูงสุดและเส้นเกณฑ์ ปัดขึ้นเป็นทีละ 0.05°) ไม่งั้นเส้นเกณฑ์หลุดกราฟเมื่อทุกค่าต่ำมาก
//   ค่าที่ไม่มี = null (เส้นขาด ไม่ใช่ 0)
// - อายุกับความคลาด (ageOption): จุดต่อดวง x = อายุข้อมูล (วัน) y = ค่ากลางระยะ 3 มิติ (km) แยก series ตามระบบ (สีของระบบ) เปิด large mode (R-3)
//   จุดเก็บ PRN เป็นช่องที่สามไว้แสดงใน tooltip (escape ก่อนเสมอ)
// - สี พื้น ตัวอักษรและเส้นตารางมาจาก GraphTheme เดียวกับหน้าต่างกราฟ (readGraphTheme)

import { systemTokenOf } from "../../cesium/colors";
import { escapeHtml, type GraphTheme } from "../Graph/options";
import { compareSystems, type Trend } from "./rows";

type Option = Record<string, unknown>;

export interface ChartCtx {
  theme: GraphTheme;
  /** ชื่อที่แสดงของระบบจากอักษรนำ (G -> GPS) */
  systemName(letter: string): string;
  /** ชื่อแกนของกราฟอายุกับความคลาด (ไม่ระบุ = ไม่มีชื่อแกน) */
  xName?: string;
  yName?: string;
  /** ข้อความตัวเลขใน tooltip ของจุด (อายุเป็นวัน, ระยะคลาดเป็น km) มาจาก labels.ts ผู้เรียกใส่หน่วยเอง ไม่ระบุ = ตัวเลขเปล่า */
  pointText?(age: number, d3Km: number): string;
}

/** สีของระบบ ไม่ใช่สี่ระบบ = สีรอง */
function systemColor(letter: string, theme: GraphTheme): string {
  const token = systemTokenOf(letter);
  return token === null ? theme.muted : theme.systems[token];
}

function axisCommon(theme: GraphTheme): Option {
  return {
    axisLabel: { color: theme.text },
    axisLine: { lineStyle: { color: theme.axis } },
    axisTick: { lineStyle: { color: theme.axis } },
    splitLine: { show: true, lineStyle: { color: theme.grid } },
  };
}

function base(theme: GraphTheme, legend: string[]): Option {
  return {
    animation: false,
    backgroundColor: theme.bg,
    textStyle: { color: theme.text },
    legend: { type: "scroll", top: 4, data: legend, textStyle: { color: theme.text }, pageTextStyle: { color: theme.text }, inactiveColor: theme.muted },
    grid: { left: 56, right: 24, top: 40, bottom: 44, containLabel: false },
  };
}

/** กราฟแนวโน้ม P99 ของ ΔEl หรือ ΔAz ต่อระบบตามวัน พร้อมเส้นเกณฑ์ */
export function trendOption(trend: Trend, ctx: ChartCtx): Option {
  const { theme } = ctx;
  const names = trend.series.map((s) => ctx.systemName(s.system));
  const lines = trend.series.map((s, i) => {
    const color = systemColor(s.system, theme);
    return {
      type: "line", name: names[i], data: s.values, color, itemStyle: { color }, lineStyle: { color, width: 2 },
      symbol: "circle", symbolSize: 6, connectNulls: false,
    };
  });
  const limit = {
    id: "limit", type: "line", data: [], silent: true,
    markLine: {
      silent: true, symbol: ["none", "none"], animation: false,
      lineStyle: { color: theme.now, type: "dashed", width: 1.5 },
      label: { show: true, color: theme.text, position: "insideEndTop", formatter: `${trend.limit}°` },
      data: [{ yAxis: trend.limit }],
    },
  };
  return {
    ...base(theme, names),
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "line", lineStyle: { color: theme.muted } } },
    xAxis: { type: "category", data: trend.days, ...axisCommon(theme) },
    yAxis: {
      type: "value", min: 0, max: (v: { min: number; max: number }) => Math.ceil(Math.max(v.max, trend.limit) * 1.1 * 20) / 20,
      ...axisCommon(theme),
    },
    series: [...lines, limit],
  };
}

/** กราฟจุด: อายุข้อมูลวงโคจร (วัน) กับค่ากลางระยะคลาด 3 มิติ (km) ของทุกดาวทุกวัน */
export function ageOption(points: readonly (readonly [number, number, string])[], ctx: ChartCtx): Option {
  const { theme } = ctx;
  const bySystem = new Map<string, [number, number, string][]>();
  for (const p of points) {
    const letter = p[2].charAt(0);
    const list = bySystem.get(letter) ?? [];
    list.push([p[0], p[1], p[2]]);
    bySystem.set(letter, list);
  }
  const letters = [...bySystem.keys()].sort(compareSystems);
  const series = letters.map((letter) => {
    const color = systemColor(letter, theme);
    return {
      type: "scatter", name: ctx.systemName(letter), data: bySystem.get(letter)!, color, itemStyle: { color, opacity: 0.8 },
      symbolSize: 6, large: true, largeThreshold: 2000,
    };
  });
  const axis = (name: string | undefined): Option => ({
    type: "value", min: 0, ...axisCommon(theme),
    ...(name === undefined ? {} : { name, nameLocation: "middle", nameGap: 26, nameTextStyle: { color: theme.text } }),
  });
  return {
    ...base(theme, series.map((s) => s.name)),
    tooltip: {
      trigger: "item", confine: true,
      formatter: (p: { data: [number, number, string]; seriesName?: string }) =>
        `${escapeHtml(p.data[2])} (${escapeHtml(p.seriesName ?? "")})<br/>${escapeHtml(ctx.pointText?.(p.data[0], p.data[1]) ?? `${p.data[0]}, ${p.data[1]}`)}`,
    },
    xAxis: axis(ctx.xName),
    yAxis: axis(ctx.yName),
    series,
  };
}
