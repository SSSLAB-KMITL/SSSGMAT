// กลางวันกลางคืนของหน้าต่าง 2D (src/cesium/night.ts): จุดใต้ดวงอาทิตย์, เส้นแบ่งกลางวันกลางคืน (Show Outline) และ polygon กลางคืน
// (Shading ใช้แสงของ globe ของ Cesium: spec §17 W2 ตรวจแล้วว่าใช้ได้ในโหมด 2D)
// ค่าที่คาด: ช่วงอายันและวิษุวัตของปี 2026, สมการเวลา (equation of time) และเรขาคณิตของทรงกลม

import { describe, expect, test } from "vitest";
import { nightPolygon, subsolarPoint, terminator } from "../../src/cesium/night";

const RAD = Math.PI / 180;

function greatCircle(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const v = (lat: number, lon: number) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
  const [a, b] = [v(lat1, lon1), v(lat2, lon2)];
  const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return Math.atan2(Math.hypot(cross[0], cross[1], cross[2]), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
}

/** จุดอยู่ใน polygon บนระนาบลองจิจูด/ละติจูดไหม (ray casting) */
function inside(poly: [number, number][], lon: number, lat: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const wrap = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;

test("subsolar point near the June 2026 solstice", () => {
  const s = subsolarPoint(new Date("2026-06-21T12:00:00Z")); expect(s.lat).toBeCloseTo(23.44, 0); expect(Math.abs(s.lon)).toBeLessThan(1);
});

describe("subsolarPoint", () => {
  test("the sun is over the equator at the March 2026 equinox and over the Tropic of Capricorn at the December solstice", () => {
    expect(Math.abs(subsolarPoint(new Date("2026-03-20T14:46:00Z")).lat)).toBeLessThan(0.05);
    expect(subsolarPoint(new Date("2026-12-21T20:50:00Z")).lat).toBeCloseTo(-23.44, 1);
  });

  test("at 12:00 UTC the longitude is the equation of time: early November the sun runs about 16.4 min fast", () => {
    expect(subsolarPoint(new Date("2026-11-03T12:00:00Z")).lon).toBeCloseTo(-4.1, 1);
  });

  test("the point moves west 15° an hour", () => {
    const a = subsolarPoint(new Date("2026-11-11T00:00:00Z"));
    const b = subsolarPoint(new Date("2026-11-11T01:00:00Z"));
    expect(wrap(b.lon - a.lon)).toBeCloseTo(-15, 1);
  });
});

describe("nightPolygon", () => {
  const june = new Date("2026-06-21T12:00:00Z");
  const december = new Date("2026-12-21T06:00:00Z");

  test("n + 1 terminator points from -180° to 180°, then the dark pole", () => {
    const poly = nightPolygon(june, 180);
    expect(poly).toHaveLength(183);
    expect(poly[0][0]).toBe(-180);
    expect(poly[180][0]).toBe(180);
    expect(poly.slice(181)).toEqual([[180, -90], [-180, -90]]); // มิถุนายน: ขั้วใต้มืด
    expect(nightPolygon(december).slice(-2)).toEqual([[180, 90], [-180, 90]]); // ธันวาคม: ขั้วเหนือมืด
  });

  test("every terminator point is 90° from the subsolar point", () => {
    for (const d of [june, december, new Date("2026-11-11T03:30:00Z")]) {
      const s = subsolarPoint(d);
      for (const [lon, lat] of terminator(d, 90)) expect(Math.abs(greatCircle(s.lat, s.lon, lat, lon) - Math.PI / 2)).toBeLessThan(1e-9);
    }
  });

  test("the antisolar point is inside and the subsolar point is outside", () => {
    for (const d of [june, december, new Date("2026-11-11T03:30:00Z")]) {
      const s = subsolarPoint(d);
      const poly = nightPolygon(d);
      expect(inside(poly, wrap(s.lon + 180), -s.lat)).toBe(true);
      expect(inside(poly, s.lon, s.lat)).toBe(false);
    }
  });

  test("terminator() is the polygon without its pole corners", () => {
    expect(terminator(june, 36)).toEqual(nightPolygon(june, 36).slice(0, 37));
  });
});
