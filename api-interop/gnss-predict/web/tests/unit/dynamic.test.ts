// Dynamic Display (spec §6.1): ค่าที่เวลาปัจจุบันจากตารางที่โหลดครั้งเดียว ค่าต่อเนื่องประมาณเชิงเส้น มุมไปทางสั้นที่สุด
// ค่าแบบนับใช้จุดก่อนหน้า นอกช่วงหรือข้ามช่องว่างที่ยาวเกิน maxGapMs = null

import { describe, expect, test } from "vitest";
import { valueAt, type Interp } from "../../src/data/dynamic";

const T0 = Date.UTC(2026, 10, 15, 0, 0, 0);
const STEP = 60_000;
const MAX_GAP = 90_000; // step × 1.5

/** แถวแบบ /reports: ช่องแรกเป็นเวลา ISO ช่องถัดไปเป็นค่า */
function table(values: (number | null)[][]): { rows: unknown[][]; times: number[] } {
  const times = values.map((_, i) => T0 + i * STEP);
  return { rows: values.map((v, i) => [new Date(times[i]).toISOString(), ...v]), times };
}

describe("valueAt", () => {
  test("linear between points", () => {
    const { rows, times } = table([[10], [20]]);
    expect(valueAt(rows, times, T0 + STEP / 2, ["linear", "linear"], MAX_GAP)).toEqual([null, 15]);
    expect(valueAt(rows, times, T0 + STEP / 4, ["linear", "linear"], MAX_GAP)?.[1]).toBeCloseTo(12.5, 12);
  });

  test("previous keeps the earlier count", () => {
    const { rows, times } = table([[5], [7]]);
    expect(valueAt(rows, times, T0 + STEP / 2, ["previous", "previous"], MAX_GAP)).toEqual([null, 5]);
    expect(valueAt(rows, times, T0 + STEP - 1, ["linear", "previous"], MAX_GAP)?.[1]).toBe(5);
  });

  test("azimuth interpolates across north", () => {
    const { rows, times } = table([[359], [1]]);
    const interps: Interp[] = ["linear", "angle"];
    expect(valueAt(rows, times, T0 + STEP / 2, interps, MAX_GAP)?.[1]).toBeCloseTo(0, 12);
    expect(valueAt(rows, times, T0 + STEP / 4, interps, MAX_GAP)?.[1]).toBeCloseTo(359.5, 12);
    expect(valueAt(rows, times, T0 + (3 * STEP) / 4, interps, MAX_GAP)?.[1]).toBeCloseTo(0.5, 12);
    // ทางกลับ (1 → 359) ก็ผ่านทิศเหนือ ผลอยู่ใน [0, 360) เสมอ
    const back = table([[1], [359]]);
    const mid = valueAt(back.rows, back.times, T0 + STEP / 2, interps, MAX_GAP)?.[1];
    expect(mid).toBeGreaterThanOrEqual(0);
    expect(mid).toBeLessThan(360);
    expect(Math.min(mid as number, 360 - (mid as number))).toBeCloseTo(0, 12);
    expect(valueAt(back.rows, back.times, T0 + STEP / 4, interps, MAX_GAP)?.[1]).toBeCloseTo(0.5, 12);
  });

  test("longitude stays in (-180, 180] across the date line", () => {
    // LLA Lon ติด interp angle แต่ engine ส่งค่าใน (-180, 180]: ผลต้องอยู่ในช่วงเดียวกับข้อมูล ไม่ใช่ [0, 360)
    const { rows, times } = table([[179], [-179]]);
    const interps: Interp[] = ["linear", "angle"];
    expect(valueAt(rows, times, T0 + STEP / 2, interps, MAX_GAP)?.[1]).toBeCloseTo(180, 12);
    expect(valueAt(rows, times, T0 + STEP / 4, interps, MAX_GAP)?.[1]).toBeCloseTo(179.5, 12);
    expect(valueAt(rows, times, T0 + (3 * STEP) / 4, interps, MAX_GAP)?.[1]).toBeCloseTo(-179.5, 12);
    const west = table([[-10], [-20]]);
    expect(valueAt(west.rows, west.times, T0 + STEP / 2, interps, MAX_GAP)?.[1]).toBeCloseTo(-15, 12);
  });

  test("IPP Lon interpolates linearly", () => {
    // IPP Lon ติด interp linear: ไม่วนรอบ
    const { rows, times } = table([[170], [-170]]);
    expect(valueAt(rows, times, T0 + STEP / 2, ["linear", "linear"], MAX_GAP)?.[1]).toBeCloseTo(0, 12);
  });

  test("null outside the rows and across a gap", () => {
    const { rows, times } = table([[10], [20]]);
    const interps: Interp[] = ["linear", "linear"];
    expect(valueAt(rows, times, T0 - 1, interps, MAX_GAP)).toBeNull();
    expect(valueAt(rows, times, T0 + STEP + 1, interps, MAX_GAP)).toBeNull();
    expect(valueAt([], [], T0, interps, MAX_GAP)).toBeNull();
    // ช่องว่าง 600000 ms (ออกจาก access แล้วกลับเข้ามา) กับ maxGap 90000 → null ทั้งตรงกลางและแบบ previous
    const gapTimes = [T0, T0 + 600_000];
    const gapRows = [["a", 10], ["b", 20]];
    expect(valueAt(gapRows, gapTimes, T0 + 300_000, interps, MAX_GAP)).toBeNull();
    expect(valueAt(gapRows, gapTimes, T0 + 300_000, ["linear", "previous"], MAX_GAP)).toBeNull();
    // จุดที่ปลายช่องว่างยังได้ค่าของมัน
    expect(valueAt(gapRows, gapTimes, T0 + 600_000, interps, MAX_GAP)).toEqual([null, 20]);
  });

  test("exact sample returns it", () => {
    const { rows, times } = table([[10, 359, 5, null], [20, 1, 7, 2], [30, 3, 9, 4]]);
    const interps: Interp[] = ["linear", "linear", "angle", "previous", "linear"];
    expect(valueAt(rows, times, T0, interps, MAX_GAP)).toEqual([null, 10, 359, 5, null]);
    expect(valueAt(rows, times, T0 + STEP, interps, MAX_GAP)).toEqual([null, 20, 1, 7, 2]);
    expect(valueAt(rows, times, T0 + 2 * STEP, interps, MAX_GAP)).toEqual([null, 30, 3, 9, 4]);
  });

  test("a missing endpoint gives null for that column only; none interpolates nothing", () => {
    const { rows, times } = table([[1.5, null, 3], [2.5, 4, 5]]);
    const out = valueAt(rows, times, T0 + STEP / 2, ["linear", "linear", "linear", "none"], MAX_GAP);
    expect(out).toEqual([null, 2, null, null]);
    expect(valueAt(rows, times, T0 + STEP, ["linear", "linear", "linear", "none"], MAX_GAP)).toEqual([null, 2.5, 4, 5]);
  });

  test("finds the bracket in a long table", () => {
    const n = 2000;
    const { rows, times } = table(Array.from({ length: n }, (_, i) => [i * 2]));
    expect(valueAt(rows, times, T0 + 1234 * STEP + STEP / 2, ["linear", "linear"], MAX_GAP)?.[1]).toBeCloseTo(2469, 9);
  });
});
