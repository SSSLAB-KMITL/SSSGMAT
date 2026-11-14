// ECharts (ราว 1 MB) ห้ามอยู่ใน bundle หลัก: โหลดได้ทางเดียวคือ import("echarts") ใน windows/Graph/chart.ts (Global Constraints)
// ถ้าโมดูลของรายงาน/Dynamic Display/ตัวโหลด import "echarts" แบบ static การ import ข้างล่างจะล้มดัง ๆ ส่วน loadECharts ต้อง reject
// (พิสูจน์ว่า import อยู่ในฟังก์ชัน ไม่ใช่ตอนโหลดโมดูล) และไม่มีไฟล์ใดใน src อ้าง "echarts" นอกจาก chart.ts

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
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

test("only windows/Graph/chart.ts names the echarts module, and only as a dynamic import", () => {
  const src = resolve(import.meta.dirname, "../../src");
  const mentions = sourceFiles(src)
    .map((file) => ({ file: relative(src, file).split("\\").join("/"), text: readFileSync(file, "utf8") }))
    .filter(({ text }) => /["'](echarts|zrender)(\/[^"']*)?["']/.test(text));
  expect(mentions.map((m) => m.file)).toEqual(["windows/Graph/chart.ts"]);
  const chart = mentions[0].text;
  // import แบบ static (ยกเว้น import type ที่ถูกลบตอน build) หรือ export ... from ลาก echarts เข้า chunk ของผู้ที่ import chart.ts
  expect(chart).not.toMatch(/^\s*import\s(?!type\s)[^(]*["']echarts["']/m);
  expect(chart).not.toMatch(/^\s*export\s[^(]*from\s*["']echarts["']/m);
  // typeof import("echarts") เป็นแค่ type: import จริงที่รันมีที่เดียว
  expect(chart.match(/(?<!typeof\s*)import\(\s*["']echarts["']\s*\)/g)).toHaveLength(1);
});
