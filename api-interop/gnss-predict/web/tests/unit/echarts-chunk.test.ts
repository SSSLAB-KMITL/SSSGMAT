// ECharts (ราว 1 MB) ห้ามอยู่ใน bundle หลัก: โหลดได้ทางเดียวคือ import("echarts") ใน windows/Graph/chart.ts (Global Constraints)
// ถ้าโมดูลของรายงาน/Dynamic Display/ตัวโหลด import "echarts" แบบ static การ import ข้างล่างจะล้มดัง ๆ ส่วน loadECharts ต้อง reject
// (พิสูจน์ว่า import อยู่ในฟังก์ชัน ไม่ใช่ตอนโหลดโมดูล) และ JS ที่ build ได้จาก src อ้าง "echarts" ที่เดียวคือ chart.ts
// (type อย่าง import type { EChartsOption } หรือ import("echarts").X ใช้ได้ทุกไฟล์ เพราะถูกลบตอน build)

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { transformWithOxc } from "vite";
import { expect, test, vi } from "vitest";

vi.mock("echarts", () => {
  throw new Error("echarts must load lazily");
});

test("the report data, the dynamic display and the chart loader do not load echarts", async () => {
  const reports = await import("../../src/data/reports");
  const dynamic = await import("../../src/data/dynamic");
  const chart = await import("../../src/windows/Graph/chart");
  expect(typeof reports.fetchReport).toBe("function");
  expect(typeof dynamic.valueAt).toBe("function");
  expect(typeof chart.loadECharts).toBe("function");
  await expect(chart.loadECharts()).rejects.toThrow();
});

test("a failed load is not memoised, so a later call tries again", async () => {
  const { loadECharts } = await import("../../src/windows/Graph/chart");
  const first = loadECharts();
  await expect(first).rejects.toThrow();
  const second = loadECharts();
  expect(second).not.toBe(first);
  await expect(second).rejects.toThrow();
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? sourceFiles(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

const MODULE = /["'](echarts|zrender)(\/[^"']*)?["']/;

/** JS ที่ build ได้จากไฟล์ (oxc ตัวเดียวกับ vite build): type ทุกแบบถูกลบแล้ว เหลือแต่การอ้างที่รันจริง */
async function emitted(file: string): Promise<string> {
  const { code } = await transformWithOxc(readFileSync(file, "utf8"), file, { lang: file.endsWith(".tsx") ? "tsx" : "ts" });
  return code;
}

test("the build keeps only one reference to echarts, the dynamic import in windows/Graph/chart.ts", async () => {
  const src = resolve(import.meta.dirname, "../../src");
  const runtime: { file: string; code: string }[] = [];
  for (const file of sourceFiles(src)) {
    if (!MODULE.test(readFileSync(file, "utf8"))) continue; // ไฟล์ที่ไม่เอ่ยถึงเลย ไม่ต้องแปลง
    const code = await emitted(file);
    if (MODULE.test(code)) runtime.push({ file: relative(src, file).split("\\").join("/"), code });
  }
  expect(runtime.map((m) => m.file)).toEqual(["windows/Graph/chart.ts"]);
  const refs = runtime[0].code.match(new RegExp(MODULE.source, "g")) ?? [];
  expect(refs).toEqual(['"echarts"']);
  expect(runtime[0].code).toMatch(/import\(\s*"echarts"\s*\)/);
});

test("type-only forms are erased and runtime forms are caught", async () => {
  // แบบที่ Task 10 ใช้ได้ (EChartsOption ฯลฯ) ต้องหายหมดหลัง build; แบบที่ลาก echarts เข้า chunk ต้องเหลืออยู่ให้ test ข้างบนจับได้
  const erased = [
    'import type { EChartsOption } from "echarts";\nexport let o: EChartsOption | null = null;',
    'import { type SeriesOption } from "echarts";\nexport let s: SeriesOption | null = null;',
    'export type X = import("echarts").EChartsOption;',
    'export type L = typeof import("echarts");',
    'export type { EChartsOption } from "echarts";',
  ];
  for (const text of erased) {
    const { code } = await transformWithOxc(text, "x.ts", { lang: "ts" });
    expect(code, text).not.toMatch(MODULE);
  }
  const kept = [
    'import * as echarts from "echarts";\nexport const init = echarts.init;',
    'import "echarts";',
    'export { init } from "echarts";',
    'export const load = () => import("echarts").then((m) => m.init);',
    'import { init } from "zrender";\nexport const z = init;',
  ];
  for (const text of kept) {
    const { code } = await transformWithOxc(text, "x.ts", { lang: "ts" });
    expect(code, text).toMatch(MODULE);
  }
});
