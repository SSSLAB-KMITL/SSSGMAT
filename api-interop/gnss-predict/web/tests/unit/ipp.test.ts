// จุดและเส้นทาง IPP ของหน้าต่าง 2D (src/cesium/ipp.ts, ของเราเอง spec §9.3): เลือกจาก aer.csv ของ Facility ตามเวลาและมุมเงยต่ำสุด

import { describe, expect, test } from "vitest";
import { indexAer, ippAt, IPP_TRACK_HALF_MS } from "../../src/cesium/ipp";
import type { AerRow } from "../../src/data/files";

const T0 = Date.parse("2026-11-11T00:00:00Z");
const STEP = 30_000;

function row(k: number, prn: string, el: number, lat: number | null = 10 + k / 100, lon: number | null = 100 + k / 100): AerRow {
  const t = T0 + k * STEP;
  return { time_utc: new Date(t).toISOString(), t, prn, az_deg: 0, el_deg: el, range_km: 20_000, ipp_lat_deg: lat, ipp_lon_deg: lon, mf: 1 };
}

/** G01 อยู่สูงตลอด, G02 ขึ้นจากต่ำกว่าเกณฑ์, E05 ไม่มี IPP ที่ epoch 40 (null), ไฟล์มี 0..99 epoch (ทุก 30 วินาที) */
function rows(): AerRow[] {
  const out: AerRow[] = [];
  for (let k = 0; k < 100; k++) {
    out.push(row(k, "G01", 45));
    out.push(row(k, "G02", k < 30 ? 5 : 20));
    out.push(k === 40 ? row(k, "E05", 30, null, null) : row(k, "E05", 30));
  }
  return out;
}

describe("ippAt", () => {
  const index = indexAer(rows());

  test("points are the rows of the latest epoch at or before t that clear the minimum elevation and have an IPP", () => {
    const at = ippAt(index, T0 + 20 * STEP + 10_000, 10);
    expect(at.points.map((p) => p.prn)).toEqual(["G01", "E05"]); // G02 ยังต่ำกว่า 10°
    expect(at.points[0]).toMatchObject({ prn: "G01", lat: 10.2, lon: 100.2, el: 45 });
    expect(ippAt(index, T0 + 40 * STEP, 10).points.map((p) => p.prn)).toEqual(["G01", "G02"]); // E05 ไม่มี IPP ที่ epoch นี้
  });

  test("the minimum elevation is inclusive", () => {
    expect(ippAt(index, T0 + 50 * STEP, 20).points.map((p) => p.prn)).toEqual(["G01", "G02", "E05"]);
    expect(ippAt(index, T0 + 50 * STEP, 20.5).points.map((p) => p.prn)).toEqual(["G01", "E05"]);
  });

  test("nothing before the first epoch or more than one step after the last", () => {
    expect(ippAt(index, T0 - 1, 0).points).toEqual([]);
    expect(ippAt(index, T0 + 99 * STEP + STEP, 0).points.length).toBe(3);
    expect(ippAt(index, T0 + 99 * STEP + STEP + 1, 0).points).toEqual([]);
  });

  test("each satellite in view gets its track from t − 10 min to t + 10 min", () => {
    expect(IPP_TRACK_HALF_MS).toBe(600_000);
    const at = ippAt(index, T0 + 50 * STEP, 10);
    const g01 = at.tracks.find((tr) => tr.prn === "G01")!;
    expect(g01.segments).toHaveLength(1);
    expect(g01.segments[0]).toHaveLength(41); // epoch 30..70
    expect(g01.segments[0][0]).toEqual([100.3, 10.3]);
    expect(g01.segments[0].at(-1)).toEqual([100.7, 10.7]);
    expect(at.tracks.map((tr) => tr.prn)).toEqual(["G01", "G02", "E05"]);
  });

  test("tracks break where the satellite is below the minimum or has no IPP, and only satellites in view have one", () => {
    const at = ippAt(index, T0 + 35 * STEP, 10);
    const g02 = at.tracks.find((tr) => tr.prn === "G02")!;
    expect(g02.segments.map((s) => s.length)).toEqual([26]); // epoch 30..55 (ต่ำกว่า 10° ก่อน epoch 30)
    const e05 = at.tracks.find((tr) => tr.prn === "E05")!;
    expect(e05.segments.map((s) => s.length)).toEqual([25, 15]); // 15..39 | 41..55 (ไม่มี IPP ที่ 40)
    const early = ippAt(index, T0 + 10 * STEP, 10);
    expect(early.tracks.map((tr) => tr.prn)).toEqual(["G01", "E05"]);
  });

  test("a missing epoch breaks the track as well", () => {
    const gappy = indexAer(rows().filter((r) => !(r.prn === "G01" && r.t === T0 + 52 * STEP)));
    const g01 = ippAt(gappy, T0 + 50 * STEP, 10).tracks.find((tr) => tr.prn === "G01")!;
    expect(g01.segments.map((s) => s.length)).toEqual([22, 18]);
  });

  test("an empty file has no points and no tracks", () => {
    expect(ippAt(indexAer([]), T0, 0)).toEqual({ points: [], tracks: [] });
  });
});
